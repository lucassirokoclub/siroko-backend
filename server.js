require("dotenv").config();
const express = require("express");
const cors = require("cors");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const { Pool } = require("pg");

const app = express();
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

app.use(cors({ origin: "*" }));
app.use(express.json());

// Health check
app.get("/", async (req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ status: "ok", servicio: "Siroko Reservas API", db: "conectada" });
  } catch (e) {
    res.json({ status: "ok", servicio: "Siroko Reservas API", db: "sin conexion" });
  }
});

// GET actividades
app.get("/api/actividades", async (req, res) => {
  try {
    const r = await pool.query("SELECT * FROM actividades WHERE activa = true ORDER BY id");
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET horarios por actividad
app.get("/api/horarios", async (req, res) => {
  try {
    const { actividad_id } = req.query;
    const q = actividad_id
      ? "SELECT h.*, a.nombre as actividad_nombre, a.precio_base, a.color FROM horarios h JOIN actividades a ON h.actividad_id = a.id WHERE h.activo = true AND h.actividad_id = $1 ORDER BY h.dia_semana, h.hora_inicio"
      : "SELECT h.*, a.nombre as actividad_nombre, a.precio_base, a.color FROM horarios h JOIN actividades a ON h.actividad_id = a.id WHERE h.activo = true ORDER BY h.dia_semana, h.hora_inicio";
    const r = actividad_id ? await pool.query(q, [actividad_id]) : await pool.query(q);
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST horario
app.post("/api/horarios", async (req, res) => {
  try {
    const { actividad_id, dia_semana, hora_inicio, hora_fin, plazas_max, monitor, nivel, recurrencia } = req.body;
    const r = await pool.query(
      "INSERT INTO horarios (actividad_id, dia_semana, hora_inicio, hora_fin, plazas_max, monitor, nivel, recurrencia) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *",
      [actividad_id, dia_semana, hora_inicio, hora_fin, plazas_max, monitor, nivel, recurrencia || "semanal"]
    );
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT horario
app.put("/api/horarios/:id", async (req, res) => {
  try {
    const { actividad_id, dia_semana, hora_inicio, hora_fin, plazas_max, monitor, nivel, recurrencia } = req.body;
    const r = await pool.query(
      "UPDATE horarios SET actividad_id=$1, dia_semana=$2, hora_inicio=$3, hora_fin=$4, plazas_max=$5, monitor=$6, nivel=$7, recurrencia=$8 WHERE id=$9 RETURNING *",
      [actividad_id, dia_semana, hora_inicio, hora_fin, plazas_max, monitor, nivel, recurrencia, req.params.id]
    );
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE horario
app.delete("/api/horarios/:id", async (req, res) => {
  try {
    await pool.query("UPDATE horarios SET activo = false WHERE id = $1", [req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET reservas
app.get("/api/reservas", async (req, res) => {
  try {
    const r = await pool.query(
      "SELECT rv.*, a.nombre as actividad_nombre FROM reservas rv LEFT JOIN actividades a ON rv.actividad_id = a.id ORDER BY rv.creada_en DESC LIMIT 100"
    );
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST crear pago Stripe
app.post("/api/crear-pago", async (req, res) => {
  try {
    const { amount, currency = "eur", metadata = {} } = req.body;
    if (!amount || amount <= 0) return res.status(400).json({ error: "Importe invalido" });
    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(amount * 100),
      currency,
      metadata,
      automatic_payment_methods: { enabled: true },
    });
    res.json({ clientSecret: paymentIntent.client_secret, paymentIntentId: paymentIntent.id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST confirmar reserva (pago + guardar en BD + email)
app.post("/api/reservas", async (req, res) => {
  try {
    const { horario_id, actividad_id, nombre, email, telefono, personas, nivel, notas, fecha_sesion, total, stripe_payment_id } = req.body;
    const r = await pool.query(
      "INSERT INTO reservas (horario_id, actividad_id, nombre, email, telefono, personas, nivel, notas, fecha_sesion, total, stripe_payment_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *",
      [horario_id, actividad_id, nombre, email, telefono, personas, nivel, notas, fecha_sesion, total, stripe_payment_id]
    );
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST enviar email Brevo
app.post("/api/enviar-email", async (req, res) => {
  try {
    const { nombre, email, actividad, dia, hora, personas, total } = req.body;
    if (!nombre || !email || !actividad) return res.status(400).json({ error: "Faltan campos" });
    const html = `<div style="font-family:sans-serif;max-width:520px;margin:0 auto;">
      <div style="background:#0F6E56;padding:24px 32px;border-radius:8px 8px 0 0;">
        <h1 style="color:#E1F5EE;font-size:20px;margin:0;">Reserva confirmada</h1>
        <p style="color:#9FE1CB;font-size:14px;margin:4px 0 0;">Outdoor · Siroko Sport Club</p>
      </div>
      <div style="background:#f9f9f7;padding:24px 32px;border-radius:0 0 8px 8px;">
        <p>Hola <strong>${nombre}</strong>,</p>
        <p style="color:#555;margin-top:8px;">Tu reserva y pago han sido procesados correctamente.</p>
        <div style="background:#fff;border:1px solid #e5e5e0;border-radius:8px;padding:16px;margin:16px 0;">
          <table style="width:100%;font-size:14px;border-collapse:collapse;">
            <tr><td style="color:#888;padding:5px 0;">Actividad</td><td style="text-align:right;font-weight:600;">${actividad}</td></tr>
            <tr><td style="color:#888;padding:5px 0;">Día y hora</td><td style="text-align:right;">${dia} · ${hora}</td></tr>
            <tr><td style="color:#888;padding:5px 0;">Personas</td><td style="text-align:right;">${personas}</td></tr>
            <tr style="border-top:1px solid #eee;"><td style="padding:8px 0 0;font-weight:600;">Total abonado</td><td style="text-align:right;font-size:18px;font-weight:700;color:#0F6E56;padding:8px 0 0;">${total}€</td></tr>
          </table>
        </div>
        <p style="font-size:13px;color:#888;">¡Nos vemos pronto!<br><strong>Equipo Outdoor Siroko Sport Club</strong></p>
      </div>
    </div>`;
    const response = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "Content-Type": "application/json", "api-key": process.env.BREVO_API_KEY },
      body: JSON.stringify({
        sender: { name: process.env.BREVO_SENDER_NAME, email: process.env.BREVO_SENDER_EMAIL },
        to: [{ email, name: nombre }],
        subject: `Reserva confirmada · ${actividad} — Siroko Sport Club`,
        htmlContent: html,
      }),
    });
    if (!response.ok) { const err = await response.json(); throw new Error(err.message); }
    const data = await response.json();
    // Marcar email enviado en BD si hay reserva_id
    if (req.body.reserva_id) {
      await pool.query("UPDATE reservas SET email_enviado = true WHERE id = $1", [req.body.reserva_id]);
    }
    res.json({ success: true, messageId: data.messageId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log("Siroko API en puerto " + PORT);
  console.log("Stripe: " + (process.env.STRIPE_SECRET_KEY ? "OK" : "falta"));
  console.log("Brevo: " + (process.env.BREVO_API_KEY ? "OK" : "falta"));
  console.log("DB: " + (process.env.DATABASE_URL ? "OK" : "falta"));
});
