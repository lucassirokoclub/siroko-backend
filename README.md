# Siroko Reservas — Backend

Backend seguro para el sistema de reservas de **Outdoor Siroko Sport Club**.  
Gestiona los pagos con Stripe y las notificaciones por email con Brevo.

---

## Instalación

```bash
cd siroko-backend
npm install
```

---

## Configuración

Abre el archivo `.env` y pega tus claves reales:

```env
STRIPE_SECRET_KEY=sk_live_...
STRIPE_PUBLISHABLE_KEY=pk_live_...
BREVO_API_KEY=xkeysib-...
BREVO_SENDER_EMAIL=escuela@siroko.com
BREVO_SENDER_NAME=Outdoor Siroko Sport Club
```

---

## Arrancar en local

```bash
npm run dev    # con recarga automática (desarrollo)
npm start      # sin recarga (producción)
```

El servidor arranca en **http://localhost:3001**

---

## Endpoints

### `POST /api/crear-pago`
Crea un PaymentIntent de Stripe.

```json
// Body
{ "amount": 40, "currency": "eur", "metadata": { "actividad": "Surf", "nombre": "María García" } }

// Respuesta
{ "clientSecret": "pi_xxx_secret_xxx", "paymentIntentId": "pi_xxx" }
```

---

### `POST /api/enviar-email`
Envía el email de confirmación de reserva vía Brevo.

```json
// Body
{
  "nombre": "María García",
  "email": "maria@ejemplo.com",
  "actividad": "Surf",
  "dia": "Sábado",
  "hora": "09:00–10:30",
  "personas": 2,
  "total": 80
}

// Respuesta
{ "success": true, "messageId": "xxx" }
```

---

### `POST /api/webhook`
Webhook de Stripe para confirmar pagos (configurar en Stripe Dashboard).

---

## Despliegue en producción

Opciones recomendadas (gratis o muy baratas):

- **Railway** → railway.app — sube el repo y añade las variables de entorno
- **Render** → render.com — igual de sencillo
- **Vercel** → convierte `server.js` a funciones serverless

Una vez desplegado, actualiza `FRONTEND_URL` en `.env` con la URL de tu frontend.
