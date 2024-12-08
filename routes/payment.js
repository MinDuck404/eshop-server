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

// Route thanh toán MoMo
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

    // Tạo chữ ký bảo mật
    const rawSignature = `accessKey=${accessKey}&amount=${amount}&extraData=${extraData}&ipnUrl=${ipnUrl}&orderId=${orderId}&orderInfo=${orderInfo}&partnerCode=${partnerCode}&redirectUrl=${redirectUrl}&requestId=${requestId}&requestType=${requestType}`;
    const signature = crypto.createHmac('sha256', secretKey).update(rawSignature).digest('hex');
    const orderData = {
        name: req.body.name,
        phoneNumber: req.body.phoneNumber,
        address: req.body.address,
        pincode: req.body.pincode,
        amount: req.body.amount,
        email: req.body.email,
        userid: req.body.userid,
        products: req.body.products
    };
    
    const extraData = Buffer.from(JSON.stringify(orderData)).toString('base64');
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

            console.log(`Xóa giỏ hàng của user: ${order.userid}`);
            // Xóa giỏ hàng của người dùng theo userId
            const deleteResult = await Cart.deleteMany({ userId: order.userid });
            console.log(`Số lượng sản phẩm đã xóa: ${deleteResult.deletedCount}`);

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
router.get('/return', async (req, res) => {
    const { orderId, resultCode, message, extraData } = req.query;
    
    try {
        if (resultCode === '0') {
            // Parse extraData to get order information
            const orderData = JSON.parse(Buffer.from(extraData, 'base64').toString());
            
            // Create new order
            const order = new Orders({
                paymentId: orderId,
                name: orderData.name,
                phoneNumber: orderData.phoneNumber,
                address: orderData.address,
                pincode: orderData.pincode,
                amount: orderData.amount,
                email: orderData.email,
                userid: orderData.userid,
                products: orderData.products,
                date: new Date(),
                status: 'paid'
            });

            // Save order to database
            await order.save();

            // Delete cart items for the user
            await Cart.deleteMany({ userId: orderData.userid });

            // Redirect to success page or send success response
            res.send(`
                <html>
                    <head>
                        <title>Payment Success</title>
                    </head>
                    <body>
                        <h1>Thanh toán thành công</h1>
                        <p>Order ID: ${orderId}</p>
                        <p>Đơn hàng của bạn đã được xác nhận</p>
                        <script>
                            // Redirect to order confirmation page after 3 seconds
                            setTimeout(() => {
                                window.location.href = '/orders/${order._id}';
                            }, 3000);
                        </script>
                    </body>
                </html>
            `);
        } else {
            // Payment failed
            res.send(`
                <html>
                    <head>
                        <title>Payment Failed</title>
                    </head>
                    <body>
                        <h1>Thanh toán không thành công</h1>
                        <p>Order ID: ${orderId}</p>
                        <p>Lỗi: ${message}</p>
                        <script>
                            // Redirect to cart page after 3 seconds
                            setTimeout(() => {
                                window.location.href = '/cart';
                            }, 3000);
                        </script>
                    </body>
                </html>
            `);
        }
    } catch (error) {
        console.error('Error processing payment return:', error);
        res.status(500).send(`
            <html>
                <head>
                    <title>Error</title>
                </head>
                <body>
                    <h1>Đã xảy ra lỗi</h1>
                    <p>Vui lòng thử lại sau</p>
                </body>
            </html>
        `);
    }
});

module.exports = router;
