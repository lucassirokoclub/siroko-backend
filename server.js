require("dotenv").config();
const express = require("express");
const cors = require("cors");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const { Pool } = require("pg");
const SibApiV3Sdk = require("sib-api-v3-sdk");

const app = express();
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

app.use(cors({ origin: "*" }));
app.use(express.json());

// Health check
app.get("/", async (req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ status: "ok", db: "conectada" });
  } catch (e) {
    res.json({ status: "ok", db: "error: " + e.message });
  }
});

// GET actividades
app.get("/api/actividades", async (req, res) => {
  try {
    const r = await pool.query("SELECT * FROM actividades ORDER BY id");
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST actividad
app.post("/api/actividades", async (req, res) => {
  try {
    const { nombre, descripcion, precio_base, color, activa } = req.body;
    const r = await pool.query(
      "INSERT INTO actividades (nombre, descripcion, precio_base, color, activa) VALUES ($1,$2,$3,$4,$5) RETURNING *",
      [nombre, descripcion, precio_base, color, activa !== undefined ? activa : true]
    );
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT actividad
app.put("/api/actividades/:id", async (req, res) => {
  try {
    const { nombre, descripcion, precio_base, color, activa } = req.body;
    const r = await pool.query(
      "UPDATE actividades SET nombre=$1, descripcion=$2, precio_base=$3, color=$4, activa=$5 WHERE id=$6 RETURNING *",
      [nombre, descripcion, precio_base, color, activa, req.params.id]
    );
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET horarios
app.get("/api/horarios", async (req, res) => {
  try {
    const { actividad_id } = req.query;
    let q = "SELECT h.*, a.nombre as actividad_nombre, a.color as actividad_color, (SELECT COUNT(*) FROM reservas r WHERE r.horario_id = h.id) as ocupacion FROM horarios h LEFT JOIN actividades a ON h.actividad_id = a.id WHERE h.activo = true";
    const params = [];
    if (actividad_id) { q += " AND h.actividad_id = $1"; params.push(actividad_id); }
    q += " ORDER BY h.dia_semana, h.hora_inicio";
    const r = await pool.query(q, params);
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST horario
app.post("/api/horarios", async (req, res) => {
  try {
    const { actividad_id, dia_semana, hora_inicio, hora_fin, plazas_max, monitor, nivel, recurrencia } = req.body;
    const r = await pool.query(
      "INSERT INTO horarios (actividad_id, dia_semana, hora_inicio, hora_fin, plazas_max, monitor, nivel, recurrencia, activo) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true) RETURNING *",
      [actividad_id, dia_semana, hora_inicio, hora_fin, plazas_max || 10, monitor, nivel || "todos", recurrencia || "semanal"]
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
    await pool.query("UPDATE horarios SET activo=false WHERE id=$1", [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET reservas
app.get("/api/reservas", async (req, res) => {
  try {
    const r = await pool.query(
      "SELECT rv.*, a.nombre as actividad_nombre FROM reservas rv LEFT JOIN actividades a ON rv.actividad_id = a.id ORDER BY rv.creada_en DESC"
    );
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST reserva
app.post("/api/reservas", async (req, res) => {
  try {
    const { horario_id, actividad_id, nombre, email, telefono, personas, nivel, notas, fecha_sesion, total, stripe_payment_id } = req.body;
    const r = await pool.query(
      "INSERT INTO reservas (horario_id, actividad_id, nombre, email, telefono, personas, nivel, notas, fecha_sesion, total, stripe_payment_id, estado) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'confirmada') RETURNING *",
      [horario_id, actividad_id, nombre, email, telefono || null, personas, nivel, notas, fecha_sesion, total, stripe_payment_id]
    );
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST crear pago Stripe
app.post("/api/crear-pago", async (req, res) => {
  try {
    const { amount, currency, metadata } = req.body;
    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(amount * 100),
      currency: currency || "eur",
      metadata: metadata || {}
    });
    res.json({ clientSecret: paymentIntent.client_secret });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST enviar email Brevo
app.post("/api/enviar-email", async (req, res) => {
  try {
    const { nombre, email, actividad, dia, hora, personas, total } = req.body;
    const client = SibApiV3Sdk.ApiClient.instance;
    client.authentications["api-key"].apiKey = process.env.BREVO_API_KEY;
    const api = new SibApiV3Sdk.TransactionalEmailsApi();
    await api.sendTransacEmail({
      sender: { email: process.env.BREVO_SENDER_EMAIL, name: process.env.BREVO_SENDER_NAME || "Siroko Club" },
      to: [{ email, name: nombre }],
      subject: "Reserva confirmada - " + actividad,
      htmlContent: "<h2>Hola " + nombre + "!</h2><p>Tu reserva esta confirmada.</p><ul><li><b>Actividad:</b> " + actividad + "</li><li><b>Dia:</b> " + dia + "</li><li><b>Hora:</b> " + hora + "</li><li><b>Personas:</b> " + personas + "</li><li><b>Total:</b> " + total + "EUR</li></ul><p>El equipo de Siroko Outdoor Club</p>"
    });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message, success: false }); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Siroko backend en puerto " + PORT));
