const express = require('express');
const crypto = require('crypto');
const https = require('https');
const router = express.Router();
const { Orders } = require('../models/orders');
const { Cart } = require('../models/cart');
const Product = require('../models/products'); // Model sản phẩm nếu cần


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
        status: "pending", // Đơn hàng đang chờ thanh toán
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
// Route nhận thông báo IPN từ MoMo
router.post('/notify', async (req, res) => {
    try {
        console.log('Received IPN notification:', req.body);
        
        const { signature, orderId, resultCode } = req.body;

        // Xác thực chữ ký
        if (!verifyMoMoSignature(req.body, signature)) {
            console.error(`Invalid signature for order ${orderId}`);
            return res.status(400).json({ message: 'Invalid signature' });
        }

        // Kiểm tra kết quả thanh toán
        if (String(resultCode) === '0') { // Chuyển resultCode thành chuỗi
            let orderData;
            try {
                // Giải mã extraData nếu có
                if (req.body.extraData) {
                    orderData = JSON.parse(Buffer.from(req.body.extraData, 'base64').toString());
                }
            } catch (error) {
                console.error('Error parsing extraData:', error);
            }

            // Cập nhật đơn hàng với trạng thái "confirmed"
            const order = await Orders.findOne({ paymentId: orderId });
            if (order) {
                order.status = 'confirmed'; // Cập nhật trạng thái
                await order.save();
                console.log(`Order updated successfully: ${orderId}`);
            }

            // Xóa giỏ hàng nếu có userid
            if (orderData?.userid) {
                try {
                    const deleteResult = await Cart.deleteMany({ userId: orderData.userid });
                    console.log(`Deleted ${deleteResult.deletedCount} items from cart for user ${orderData.userid}`);
                } catch (error) {
                    console.error('Error deleting cart:', error);
                }
            }

            return res.status(200).json({ message: 'Success' });
        } else {
            console.log(`Payment failed for order ${orderId}, result code: ${resultCode}`);
            return res.status(400).json({ message: 'Payment failed' });
        }

    } catch (error) {
        console.error('Error processing IPN:', error);
        return res.status(500).json({ message: 'Internal server error' });
    }
});


// Route trả về sau thanh toán
router.get('/return', async (req, res) => {
    const { orderId, resultCode, message } = req.query;
    
    try {
        if (resultCode === '0') {
            res.send(`
                <html>
                    <head>
                        <title>Payment Success</title>
                        <meta charset="UTF-8">
                        <style>
                            body {
                                display: flex;
                                flex-direction: column;
                                align-items: center;
                                justify-content: center;
                                height: 100vh;
                                margin: 0;
                                font-family: Arial, sans-serif;
                            }
                            .success-message {
                                color: #28a745;
                                text-align: center;
                            }
                        </style>
                    </head>
                    <body>
                        <div class="success-message">
                            <h1>Thanh toán thành công</h1>
                            <p>Mã đơn hàng: ${orderId}</p>
                            <p>Đơn hàng của bạn đã được xác nhận</p>
                            <p>Đang chuyển hướng về trang chủ...</p>
                        </div>
                        <script>
                            setTimeout(() => {
                                window.location.href = '/';
                            }, 3000);
                        </script>
                    </body>
                </html>
            `);
        } else {
            res.send(`
                <html>
                    <head>
                        <title>Payment Failed</title>
                        <meta charset="UTF-8">
                        <style>
                            body {
                                display: flex;
                                flex-direction: column;
                                align-items: center;
                                justify-content: center;
                                height: 100vh;
                                margin: 0;
                                font-family: Arial, sans-serif;
                            }
                            .error-message {
                                color: #dc3545;
                                text-align: center;
                            }
                        </style>
                    </head>
                    <body>
                        <div class="error-message">
                            <h1>Thanh toán không thành công</h1>
                            <p>Mã đơn hàng: ${orderId}</p>
                            <p>Lỗi: ${message}</p>
                            <p>Đang chuyển hướng về giỏ hàng...</p>
                        </div>
                        <script>
                            setTimeout(() => {
                                window.location.href = '/cart';
                            }, 3000);
                        </script>
                    </body>
                </html>
            `);
        }
    } catch (error) {
        console.error('Error handling return URL:', error);
        res.status(500).send(`
            <html>
                <head>
                    <title>Error</title>
                    <meta charset="UTF-8">
                    <style>
                        body {
                            display: flex;
                            flex-direction: column;
                            align-items: center;
                            justify-content: center;
                            height: 100vh;
                            margin: 0;
                            font-family: Arial, sans-serif;
                        }
                        .error-message {
                            color: #dc3545;
                            text-align: center;
                        }
                    </style>
                </head>
                <body>
                    <div class="error-message">
                        <h1>Đã xảy ra lỗi</h1>
                        <p>Vui lòng thử lại sau</p>
                        <p>Chi tiết lỗi: ${error.message}</p>
                    </div>
                </body>
            </html>
        `);
    }
});

module.exports = router;
