const express = require('express');
const crypto = require('crypto');
const https = require('https');
const router = express.Router();
const { Orders } = require('../models/orders');
const Cart = require('../models/cart'); // Import model giỏ hàng
const Product = require('../models/products'); // Import model sản phẩm (nếu cần)

// Hàm xác thực chữ ký từ MoMo
const verifySignature = (data, signature, secretKey) => {
    const rawSignature = Object.keys(data)
        .filter(key => key !== 'signature' && data[key]) // Loại bỏ `signature` và các giá trị null/undefined
        .sort()
        .map(key => `${key}=${data[key]}`)
        .join('&');

    const computedSignature = crypto.createHmac('sha256', secretKey)
        .update(rawSignature)
        .digest('hex');

    return computedSignature === signature;
};

// Route thanh toán MoMo
router.post('/pay', async (req, res) => {
    const partnerCode = "MOMO";
    const accessKey = "F8BBA842ECF85";
    const secretKey = "K951B6PE1waDMi640xX08PD3vg6EkVlz";
    const orderId = `MOMO${new Date().getTime()}`; // Tạo unique orderId
    const requestId = orderId;
    const amount = req.body.amount;
    const orderInfo = "Thanh toán qua MoMo";
    const redirectUrl = "https://eshop-server-x4w1.onrender.com/api/payment/return";
    const ipnUrl = "https://eshop-server-x4w1.onrender.com/api/payment/notify";
    const requestType = "captureWallet";
    const extraData = "";

    // Tạo chữ ký bảo mật
    const rawSignature = `accessKey=${accessKey}&amount=${amount}&extraData=${extraData}&ipnUrl=${ipnUrl}&orderId=${orderId}&orderInfo=${orderInfo}&partnerCode=${partnerCode}&redirectUrl=${redirectUrl}&requestId=${requestId}&requestType=${requestType}`;
    const signature = crypto.createHmac('sha256', secretKey).update(rawSignature).digest('hex');

    const requestBody = JSON.stringify({
        partnerCode,
        accessKey,
        requestId,
        amount,
        orderId,
        orderInfo,
        redirectUrl,
        ipnUrl,
        extraData,
        requestType,
        signature,
        lang: 'en'
    });

    // Lưu thông tin đơn hàng vào cơ sở dữ liệu
    const newOrder = new Orders({
        name: req.body.name,
        phoneNumber: req.body.phoneNumber,
        address: req.body.address,
        pincode: req.body.pincode,
        amount,
        paymentId: orderId,
        email: req.body.email,
        userid: req.body.userid,
        products: req.body.products,
        status: "pending",
    });

    try {
        await newOrder.save();
        console.log(`Order created with ID: ${orderId}`);
    } catch (err) {
        console.error(`Error creating order: ${err.message}`);
        return res.status(500).json({ success: false, message: 'Failed to create order' });
    }

    // Gửi yêu cầu thanh toán tới MoMo
    const options = {
        hostname: 'test-payment.momo.vn',
        port: 443,
        path: '/v2/gateway/api/create',
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(requestBody),
        },
    };

    const reqMoMo = https.request(options, (momoRes) => {
        let data = '';
        momoRes.on('data', (chunk) => (data += chunk));
        momoRes.on('end', () => {
            const response = JSON.parse(data);
            if (response.payUrl) {
                res.json({ success: true, payUrl: response.payUrl });
            } else {
                console.error('MoMo Error:', response);
                res.status(500).json({
                    success: false,
                    message: 'Failed to create MoMo payment',
                    details: response,
                });
            }
        });
    });

    reqMoMo.on('error', (err) => {
        console.error(`Error sending request to MoMo: ${err.message}`);
        res.status(500).send('Payment request failed');
    });

    reqMoMo.write(requestBody);
    reqMoMo.end();
});

// Route nhận thông báo IPN từ MoMo
router.post('/notify', async (req, res) => {
    const secretKey = "K951B6PE1waDMi640xX08PD3vg6EkVlz";
    const { orderId, amount, resultCode, signature } = req.body;

    // Xác thực chữ ký
    if (!verifySignature(req.body, signature, secretKey)) {
        console.error(`Chữ ký không hợp lệ: Order ID ${orderId}`);
        return res.status(400).send('Chữ ký không hợp lệ');
    }

    if (resultCode === 0) { // Thanh toán thành công
        try {
            // Tìm đơn hàng trong cơ sở dữ liệu bằng paymentId
            const order = await Orders.findOne({ paymentId: orderId });

            if (!order) {
                console.error(`Không tìm thấy đơn hàng: ${orderId}`);
                return res.status(404).send('Đơn hàng không tồn tại');
            }

            // Cập nhật trạng thái đơn hàng thành 'paid'
            order.status = 'paid';
            order.paymentDate = new Date();
            await order.save();

            // Xóa sản phẩm trong giỏ hàng
            await Cart.deleteMany({ userId: order.userid });

            console.log(`Đơn hàng ${orderId} đã được thanh toán và giỏ hàng đã được xóa.`);
            res.status(200).send('OK');
        } catch (err) {
            console.error(`Lỗi cập nhật đơn hàng: ${err.message}`);
            res.status(500).send('Lỗi hệ thống');
        }
    } else {
        console.error(`Thanh toán thất bại: Order ID ${orderId}`);
        res.status(400).send('Lỗi thanh toán');
    }
});

// Route trả về sau thanh toán
router.get('/return', (req, res) => {
    const { orderId, resultCode, message } = req.query;

    if (resultCode === '0') {
        // Thanh toán thành công
        res.send(`<h1>Thanh toán thành công</h1><p>Order ID: ${orderId}</p>`);
    } else {
        // Thanh toán thất bại
        res.send(`<h1>Thanh toán không thành công</h1><p>Order ID: ${orderId}</p><p>${message}</p>`);
    }
});

module.exports = router;
