const { Cart } = require('../models/cart');
const express = require('express');
const router = express.Router();

// Lấy danh sách giỏ hàng
router.get(`/`, async (req, res) => {
    try {
        const cartList = await Cart.find(req.query);
        if (!cartList) {
            return res.status(500).json({ success: false });
        }
        return res.status(200).json(cartList);
    } catch (error) {
        res.status(500).json({ success: false });
    }
});

// Thêm sản phẩm vào giỏ hàng
router.post('/add', async (req, res) => {
    const cartItem = await Cart.find({ productId: req.body.productId, userId: req.body.userId });

    if (cartItem.length === 0) {
        let cartList = new Cart({
            productTitle: req.body.productTitle,
            image: req.body.image,
            rating: req.body.rating,
            price: req.body.price,
            quantity: req.body.quantity,
            subTotal: req.body.subTotal,
            productId: req.body.productId,
            userId: req.body.userId,
            countInStock: req.body.countInStock,
        });

        if (!cartList) {
            return res.status(500).json({ error: 'Failed to create cart item', success: false });
        }

        cartList = await cartList.save();
        return res.status(201).json(cartList);
    } else {
        return res.status(401).json({ status: false, msg: 'Product already added in the cart' });
    }
});

// Xóa sản phẩm theo ID
router.delete('/:id', async (req, res) => {
    try {
        const cartItem = await Cart.findByIdAndDelete(req.params.id);
        if (!cartItem) {
            return res.status(404).json({ success: false, message: 'Cart item not found!' });
        }
        res.status(200).json({ success: true, message: 'Cart item deleted!' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Xóa toàn bộ sản phẩm theo userId
router.delete('/user/:userId', async (req, res) => {
    try {
        const deleteResult = await Cart.deleteMany({ userId: req.params.userId });
        res.status(200).json({ 
            success: true, 
            message: `${deleteResult.deletedCount} items deleted from cart` 
        });
    } catch (err) {
        console.error(`Error deleting cart items for user ${req.params.userId}:`, err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Lấy chi tiết sản phẩm theo ID
router.get('/:id', async (req, res) => {
    try {
        const cartItem = await Cart.findById(req.params.id);
        if (!cartItem) {
            return res.status(500).json({ message: 'Cart item not found.' });
        }
        return res.status(200).send(cartItem);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Cập nhật sản phẩm
router.put('/:id', async (req, res) => {
    try {
        const cartList = await Cart.findByIdAndUpdate(
            req.params.id,
            {
                productTitle: req.body.productTitle,
                image: req.body.image,
                rating: req.body.rating,
                price: req.body.price,
                quantity: req.body.quantity,
                subTotal: req.body.subTotal,
                productId: req.body.productId,
                userId: req.body.userId
            },
            { new: true }
        );

        if (!cartList) {
            return res.status(500).json({ success: false, message: 'Failed to update cart item' });
        }

        res.send(cartList);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
