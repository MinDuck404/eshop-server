const express = require('express');
const crypto = require('crypto');
const https = require('https');
const router = express.Router();
const { Orders } = require('../models/orders');
const Cart = require('../models/cart'); // Model giỏ hàng
const Product = require('../models/products'); // Model sản phẩm nếu cần

// Hàm xác thực chữ ký từ MoMo
const verifySignature = (data, signature, secretKey) => {
    // Tạo chuỗi rawSignature theo đúng thứ tự bảng chữ cái của các tham số
    const rawSignature = Object.keys(data)
        .filter(key => key !== 'signature' && data[key]) // Loại bỏ 'signature' và các giá trị null/undefined
        .sort() // Sắp xếp các tham số theo thứ tự bảng chữ cái
        .map(key => `${key}=${data[key]}`)
        .join('&');

    // Tạo chữ ký bằng HMAC SHA256 với secretKey
    const computedSignature = crypto.createHmac('sha256', secretKey)
        .update(rawSignature)
        .digest('hex');

    return computedSignature === signature;
};

router.post('/pay', async (req, res) => {
    const partnerCode = "MOMO";
    const accessKey = "F8BBA842ECF85";
    const secretKey = "K951B6PE1waDMi640xX08PD3vg6EkVlz";
    const orderId = `MOMO${new Date().getTime()}`; // Tạo unique orderId
    const requestId = orderId;
    const amount = req.body.amount;
    const orderInfo = "Thanh toán qua MoMo";
    const redirectUrl = "https://eshop-server-x4w1.onrender.com/api/payment/return"; // URL trả về sau khi thanh toán
    const ipnUrl = "https://eshop-server-x4w1.onrender.com/api/payment/notify"; // URL nhận thông báo IPN
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
            // Tạo đơn hàng sau khi thanh toán thành công
            const order = new Orders({
                paymentId: orderId,
                amount,
                status: 'paid',
                paymentDate: new Date(),
                // Lưu các thông tin khác của đơn hàng
                name: req.body.name,
                phoneNumber: req.body.phoneNumber,
                address: req.body.address,
                pincode: req.body.pincode,
                email: req.body.email,
                userid: req.body.userid,
                products: req.body.products, // Cần đảm bảo sản phẩm từ request body
            });

            // Lưu đơn hàng vào cơ sở dữ liệu
            await order.save();
            console.log(`Đơn hàng ${orderId} đã được tạo và thanh toán`);

            // Xóa giỏ hàng của người dùng
            const deleteResult = await Cart.deleteMany({ userId: req.body.userid });
            console.log(`Giỏ hàng của user ${req.body.userid} đã được xóa. Sản phẩm đã xóa: ${deleteResult.deletedCount}`);

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
