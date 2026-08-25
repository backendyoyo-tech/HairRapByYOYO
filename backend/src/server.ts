import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";

import { requestContextMiddleware } from "./middleware/request-context.middleware.js";
import { actorContextMiddleware } from "./auth/actor.middleware.js";
import { errorHandler } from "./middleware/error-handler.middleware.js";
import authRoutes from "./auth/auth.router.js";
import adminRoutes from "./admin/admin.router.js";

const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json());

app.use(requestContextMiddleware);
app.use(actorContextMiddleware);

app.get("/api/v1/health", (req, res) => {
  res.json({
    data: {
      status: "ok",
    },
    request_id: req.requestContext.requestId,
  });
});

// Auth routes
app.use("/api/v1/auth", authRoutes);

// Admin routes
app.use("/api/v1/admin", adminRoutes);

// Error handler MUST be after all routes.
app.use(errorHandler);

const port = Number(process.env.PORT ?? 5001);

app.listen(port, () => {
  console.log(`HairRapByYOYO backend running on port ${port}`);
});