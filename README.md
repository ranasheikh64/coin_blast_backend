# Coin Blast - Backend API Server

High-performance Express.js & MongoDB Atlas backend for **Coin Blast**.

## 🚀 Features
- **Device-First Anonymous Authentication**: Instant gameplay with device ID tracking.
- **Player Wallet & Anti-Cheat Session Verification**: Validates moves, chain combos, and rewards on MongoDB Atlas.
- **Lightning Network / Crypto Cashout Integration**: Prepared for Zebedee / Satoshi withdrawals.
- **Vercel Serverless Ready**: Deployable instantly with zero configuration using `vercel.json`.

## ⚙️ Environment Variables
Copy `.env.example` to `.env` and fill in your variables:
```env
PORT=5000
MONGODB_URI=mongodb+srv://<username>:<password>@cluster0.ek5om6i.mongodb.net/coinblast
JWT_SECRET=your_jwt_secret_key
NODE_ENV=production
```

## 🛠️ Local Development
```bash
npm install
node src/app.js
```

## ☁️ Deploy to Vercel
1. Import this repository in [Vercel](https://vercel.com).
2. Add your `MONGODB_URI` and `JWT_SECRET` in **Project Settings > Environment Variables**.
3. Deploy!
