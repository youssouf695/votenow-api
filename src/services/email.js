const transporter = require("./brevo");

exports.sendVerificationEmail = async (to, code, fullName) => {
  const logoUrl =
    "https://res.cloudinary.com/duyndpaaz/image/upload/v1776296187/LogoVotenow_abbr2j.png";

  const htmlContent = `
<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Code de vérification VoteNow</title>
</head>
<body style="margin:0;padding:0;background-color:#f0f4ff;font-family:'Segoe UI',Helvetica,Arial,sans-serif;">

  <div style="padding:40px;text-align:center;">
    <img src="${logoUrl}" width="160" />
    <h2>Bonjour ${fullName}</h2>

    <p>Votre code OTP :</p>

    <div style="font-size:32px;font-weight:bold;letter-spacing:6px;">
      ${code}
    </div>

    <p>Valable 15 minutes</p>
  </div>

</body>
</html>
  `;

  try {
    const info = await transporter.sendMail({
      from: `"VoteNow" <${process.env.BREVO_USER}>`,
      to,
      subject: "🔐 Votre code de vérification VoteNow",
      html: htmlContent,
      text: `Votre code OTP est : ${code}`,
    });

    console.log("✅ Email envoyé:", info.messageId);
  } catch (error) {
    console.error("❌ Erreur email:", error);
    throw error;
  }
};