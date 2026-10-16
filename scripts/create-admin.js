require('dotenv').config()

const bcrypt = require('bcryptjs')
const sequelize = require('../src/config/database')
const { User } = require('../src/models')

async function createAdmin() {
  try {
    const email = process.env.ADMIN_EMAIL?.trim()
    const password = process.env.ADMIN_PASSWORD

    if (!email || !password) {
      throw new Error('ADMIN_EMAIL et ADMIN_PASSWORD sont requis dans le .env')
    }

    await sequelize.authenticate()

    const existing = await User.findOne({ where: { email } })

    if (existing) {
      console.log(
        `Ce compte existe déjà avec le rôle "${existing.role}". Aucune modification effectuée.`
      )
      return
    }

    await User.create({
      email,
      full_name: 'Administrateur VoteNow',
      role: 'admin',
      password_hash: await bcrypt.hash(password, 12),
      is_verified: true,
    })

    console.log('Compte administrateur créé avec succès.')
  } catch (error) {
    console.error('Échec :', error.message)
    process.exitCode = 1
  } finally {
    await sequelize.close()
  }
}

createAdmin()