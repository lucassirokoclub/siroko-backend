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
// GET horarios por actividad
app.get("/api/horarios", async (req, res) => {
  try {
    const { actividad_id } = req.query;
    const q = actividad_id
      ? "SELECT h.*, a.nombre as actividad_nombre, a.precio_base, a.color FROM horarios h JOIN actividades a ON h.actividad_id = a.id WHERE h.activo = true AND h.actividad_id = $1 ORDER BY h.dia_semana, h.hora_inicio"
