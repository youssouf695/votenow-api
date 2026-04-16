const express = require('express')
const multer = require('multer')
const { auth } = require('../middleware/auth')
const userController = require('../controllers/userController')

const router = express.Router()
const upload = multer({ dest: 'uploads/' })

// Upload avatar
router.post('/avatar', auth, upload.single('avatar'), userController.uploadAvatar)

module.exports = router