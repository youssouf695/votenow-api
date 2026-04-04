const chipdeals = require('@chipdeals/payments');

class ChipdealsService {
  constructor() {
    // Initialiser avec ta clé API (à mettre dans .env plus tard)
    this.apiKey = process.env.CHIPDEALS_API_KEY || 'test_FOdigzgSopV8GZggZa89';
    chipdeals.setApiKey(this.apiKey);
  }

  /**
   * Initier une demande de paiement (collection)
   */
  async initiatePayment({ amount, currency = 'XOF', phoneNumber, firstName, lastName, webhookUrl }) {
    try {
      // Formater le numéro avec l'indicatif pays (ex: 229 pour Bénin, 237 pour Cameroun)
      const formattedPhone = this.formatPhoneNumber(phoneNumber);
      
      const payment = chipdeals
        .collect()
        .amount(amount)
        .currency(currency)
        .from(formattedPhone)
        .firstName(firstName || '')
        .lastName(lastName || '');
      
      // Ajouter webhook si fourni
      if (webhookUrl) {
        payment.webhook(webhookUrl);
      }

      // Exécuter la demande
      return new Promise((resolve, reject) => {
        payment.create((transactionReference) => {
          console.log('✅ Transaction initiée, référence:', transactionReference);
          resolve({ 
            success: true, 
            reference: transactionReference,
            status: 'pending'
          });
        })
        .onError((error) => {
          console.error('❌ Erreur paiement:', error);
          reject(error);
        });
      });

    } catch (error) {
      console.error('Erreur initiation paiement:', error);
      throw error;
    }
  }

  /**
   * Vérifier le statut d'une transaction
   */
  async checkPaymentStatus(reference) {
    try {
      const transactionData = await chipdeals.status(reference);
      return transactionData;
    } catch (error) {
      console.error('Erreur vérification statut:', error);
      throw error;
    }
  }

  /**
   * Formater le numéro de téléphone (ajouter l'indicatif pays si nécessaire)
   */
  formatPhoneNumber(phone) {
    // Nettoyer le numéro (enlever les espaces, tirets, etc.)
    const cleaned = phone.replace(/\s+/g, '').replace(/[+]/g, '');
    
    // Si le numéro commence par 6 (Cameroun), ajouter 237
    if (cleaned.startsWith('6') && cleaned.length === 9) {
      return `237${cleaned}`;
    }
    
    // Si le numéro commence par 0 (ex: 0612345678), enlever le 0 et ajouter 237
    if (cleaned.startsWith('0') && cleaned.length === 10) {
      return `237${cleaned.substring(1)}`;
    }
    
    // Si déjà avec indicatif
    return cleaned;
  }

  /**
   * Obtenir le solde du compte
   */
  async getBalance() {
    try {
      const balance = await chipdeals.balance();
      return balance;
    } catch (error) {
      console.error('Erreur récupération solde:', error);
      throw error;
    }
  }
}

module.exports = new ChipdealsService();