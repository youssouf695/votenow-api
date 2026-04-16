const { User } = require('../models')
const cloudinary = require('cloudinary').v2

// Configuration Cloudinary (déjà dans votre service)
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
})

exports.uploadAvatar = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Aucun fichier fourni' })
    }

    // Upload vers Cloudinary
    const result = await cloudinary.uploader.upload(req.file.path, {
      folder: 'votenow/avatars',
      transformation: [
        { width: 200, height: 200, crop: 'fill' },
        { radius: 'max' }
      ]
    })

    // Mettre à jour l'utilisateur
    await User.update(
      { avatar_url: result.secure_url },
      { where: { id: req.user.id } }
    )

    res.json({
      success: true,
      avatar_url: result.secure_url
    })
  } catch (error) {
    console.error('Erreur upload avatar:', error)
    res.status(500).json({ error: error.message })
  }
}