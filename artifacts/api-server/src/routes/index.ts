import { Router, type IRouter } from "express";
import healthRouter from "./health";
import statusRouter from "./status";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/status", statusRouter);

export default router;
