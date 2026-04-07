require("dotenv").config();
const express = require("express");
const cors = require("cors");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

const app = express();

app.use(cors({ origin: process.env.FRONTEND_URL || "*" }));
app.use(express.json());

// ─────────────────────────────────────────────
//  HEALTH CHECK
// ─────────────────────────────────────────────
app.get("/", (req, res) => {
  res.json({ status: "ok", servicio: "Siroko Reservas API" });
});

// ─────────────────────────────────────────────
//  STRIPE — Crear PaymentIntent
//  POST /api/crear-pago
//  Body: { amount: 4000, currency: "eur", metadata: {...} }
// ─────────────────────────────────────────────
app.post("/api/crear-pago", async (req, res) => {
  try {
    const { amount, currency = "eur", metadata = {} } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({ error: "El importe es obligatorio y debe ser mayor que 0." });
    }

    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(amount * 100), // convertir a céntimos
      currency,
      metadata,
      automatic_payment_methods: { enabled: true },
    });

    res.json({
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
    });
  } catch (error) {
    console.error("Error Stripe:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// ─────────────────────────────────────────────
//  STRIPE — Webhook (para confirmar pagos)
//  POST /api/webhook
// ─────────────────────────────────────────────
app.post("/api/webhook", express.raw({ type: "application/json" }), (req, res) => {
  const sig = req.headers["stripe-signature"];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;
  try {
    event = webhookSecret
      ? stripe.webhooks.constructEvent(req.body, sig, webhookSecret)
      : JSON.parse(req.body);
  } catch (err) {
    return res.status(400).json({ error: `Webhook error: ${err.message}` });
  }

  if (event.type === "payment_intent.succeeded") {
    const pi = event.data.object;
    console.log(`✅ Pago confirmado: ${pi.id} — ${pi.amount / 100}€`);
    // Aquí puedes añadir lógica adicional: guardar en BD, etc.
  }

  res.json({ received: true });
});

// ─────────────────────────────────────────────
//  BREVO — Enviar email de confirmación
//  POST /api/enviar-email
//  Body: { nombre, email, actividad, dia, hora, personas, total }
// ─────────────────────────────────────────────
app.post("/api/enviar-email", async (req, res) => {
  try {
    const { nombre, email, actividad, dia, hora, personas, total } = req.body;

    if (!nombre || !email || !actividad) {
      return res.status(400).json({ error: "Faltan campos obligatorios: nombre, email, actividad." });
    }

    const htmlContent = `
      <div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#1a1a1a;">
        <div style="background:#0F6E56;padding:24px 32px;border-radius:8px 8px 0 0;">
          <h1 style="color:#E1F5EE;font-size:20px;font-weight:600;margin:0;">Reserva confirmada</h1>
          <p style="color:#9FE1CB;font-size:14px;margin:4px 0 0;">Outdoor · Siroko Sport Club</p>
        </div>
        <div style="background:#f9f9f7;padding:24px 32px;border-radius:0 0 8px 8px;">
          <p style="font-size:15px;">Hola <strong>${nombre}</strong>,</p>
          <p style="font-size:14px;color:#555;margin-top:8px;">
            Tu reserva y pago han sido procesados correctamente.
          </p>
          <div style="background:#fff;border:1px solid #e5e5e0;border-radius:8px;padding:16px;margin:16px 0;">
            <table style="width:100%;font-size:14px;border-collapse:collapse;">
              <tr>
                <td style="color:#888;padding:5px 0;">Actividad</td>
                <td style="text-align:right;font-weight:600;">${actividad}</td>
              </tr>
              <tr>
                <td style="color:#888;padding:5px 0;">Día y hora</td>
                <td style="text-align:right;">${dia} · ${hora}</td>
              </tr>
              <tr>
                <td style="color:#888;padding:5px 0;">Personas</td>
                <td style="text-align:right;">${personas}</td>
              </tr>
              <tr style="border-top:1px solid #eee;">
                <td style="color:#888;padding:8px 0 0;font-weight:600;">Total abonado</td>
                <td style="text-align:right;font-size:18px;font-weight:700;color:#0F6E56;padding:8px 0 0;">${total}€</td>
              </tr>
            </table>
          </div>
          <p style="font-size:13px;color:#888;margin-top:16px;">
            ¡Nos vemos pronto!<br>
            <strong>Equipo Outdoor Siroko Sport Club</strong>
          </p>
        </div>
      </div>
    `;

    const response = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": process.env.BREVO_API_KEY,
      },
      body: JSON.stringify({
        sender: {
          name: process.env.BREVO_SENDER_NAME,
          email: process.env.BREVO_SENDER_EMAIL,
        },
        to: [{ email, name: nombre }],
        subject: `Reserva confirmada · ${actividad} — Siroko Sport Club`,
        htmlContent,
      }),
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.message || "Error al enviar email con Brevo");
    }

    const data = await response.json();
    console.log(`📧 Email enviado a ${email} — messageId: ${data.messageId}`);
    res.json({ success: true, messageId: data.messageId });
  } catch (error) {
    console.error("Error Brevo:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// ─────────────────────────────────────────────
//  ARRANCAR SERVIDOR
// ─────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`\n🚀 Siroko API corriendo en http://localhost:${PORT}`);
  console.log(`   Stripe: ${process.env.STRIPE_SECRET_KEY ? "✅ configurado" : "❌ falta STRIPE_SECRET_KEY"}`);
  console.log(`   Brevo:  ${process.env.BREVO_API_KEY ? "✅ configurado" : "❌ falta BREVO_API_KEY"}\n`);
});
