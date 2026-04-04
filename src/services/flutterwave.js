const axios = require('axios');
const crypto = require('crypto');

// Configuration
const FLW_CLIENT_ID = process.env.FLW_PUBLIC_KEY;
const FLW_SECRET_KEY = process.env.FLW_SECRET_KEY;
const FLW_ENCRYPTION_KEY = process.env.FLW_ENCRYPTION_KEY;
const FLW_API_URL = process.env.FLW_API_URL || 'https://api.flutterwave.com/v3';

// Fonction pour chiffrer les données (optionnel)
const encryptData = (data) => {
  if (!FLW_ENCRYPTION_KEY) return data;
  try {
    const cipher = crypto.createCipheriv('des-ede3', Buffer.from(FLW_ENCRYCRYPTION_KEY, 'base64'), Buffer.alloc(0));
    let encrypted = cipher.update(data, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return encrypted;
  } catch (error) {
    console.error('Erreur chiffrement:', error);
    return data;
  }
};

// Initier un paiement
exports.initiatePayment = async ({ amount, email, phoneNumber, fullName, tx_ref, redirectUrl }) => {
  try {
    const payload = {
      tx_ref,
      amount,
      currency: 'XAF',
      redirect_url: redirectUrl,
      payment_options: 'card,mobilemoney',
      customer: {
        email: email || `${phoneNumber}@votenow.cm`,
        phonenumber: phoneNumber,
        name: fullName || 'Votant',
      },
      customizations: {
        title: 'VoteNow',
        description: 'Paiement de votes',
        logo: 'https://votenow.cm/logo.png',
      },
      meta: {
        consumer_id: 1,
        consumer_mac: '92a3-912ba-1192a',
      },
    };

    console.log('📤 Envoi à Flutterwave:', JSON.stringify(payload, null, 2));

    const response = await axios.post(`${FLW_API_URL}/payments`, payload, {
      headers: {
        'Authorization': FLW_SECRET_KEY,  // ← Pas de "Bearer "
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    });

    console.log('📥 Réponse Flutterwave:', response.data);

    if (response.data.status === 'success') {
      return {
        success: true,
        payment_link: response.data.data.link,
        transaction_id: response.data.data.id,
        tx_ref,
      };
    } else {
      throw new Error(response.data.message || 'Erreur Flutterwave');
    }
  } catch (error) {
    console.error('❌ Flutterwave error:', error.response?.data || error.message);
    throw error;
  }
};

// Vérifier un paiement
exports.verifyPayment = async (transactionId) => {
  try {
    const response = await axios.get(`${FLW_API_URL}/transactions/${transactionId}/verify`, {
      headers: {
        'Authorization': FLW_SECRET_KEY,  // ← Pas de "Bearer "
      },
      timeout: 30000,
    });

    return response.data;
  } catch (error) {
    console.error('❌ Erreur vérification:', error.response?.data || error.message);
    throw error;
  }
};

// Vérifier par référence
exports.verifyByReference = async (tx_ref) => {
  try {
    const response = await axios.get(`${FLW_API_URL}/transactions/verify_by_reference?tx_ref=${tx_ref}`, {
      headers: {
        'Authorization': FLW_SECRET_KEY,
      },
    });
    return response.data;
  } catch (error) {
    console.error('❌ Erreur vérification par référence:', error.response?.data || error.message);
    throw error;
  }
};