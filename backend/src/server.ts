import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
// import { z } from "zod";

import { requestContextMiddleware } from "./middleware/request-context.middleware.js";
import { errorHandler } from "./middleware/error-handler.middleware.js";
// import { AppError } from "./shared/errors/index.js";
// import { validate } from "./middleware/validation.middleware.js";

const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json());

app.use(requestContextMiddleware);

app.get("/api/v1/health", (req, res) => {
  res.json({
    data: {
      status: "ok",
    },
    request_id: req.requestContext.requestId,
  });
});

// app.get("/api/v1/test-error", () => {
//   throw new AppError(
//     400,
//     "D2_TEST_ERROR",
//     "This is a D2 contract error test.",
//   );
// });

// Error handler MUST be after all routes.

// app.post(
//   "/api/v1/test-validation",
//   validate({
//     body: z.object({
//       name: z.string().min(3),
//       email: z.string().email(),
//     }),
//   }),
//   (req, res) => {
//     res.json({
//       data: req.body,
//       request_id: req.requestContext.requestId,
//     });
//   },
// );

app.use(errorHandler);

const port = Number(process.env.PORT ?? 5001);

app.listen(port, () => {
  console.log(`HairRapByYOYO backend running on port ${port}`);
});