import express from "express";
import ProjectDocsController from "../../controllers/project-docs-controller";
import {verifyNonGuestProjectAccess} from "../../middlewares/verify-project-access";
import safeControllerFunction from "../../shared/safe-controller-function";

const projectDocsApiRouter = express.Router({mergeParams: true});

projectDocsApiRouter.get("/", verifyNonGuestProjectAccess("params", "projectId"), safeControllerFunction(ProjectDocsController.list));
projectDocsApiRouter.get("/task/:taskId", verifyNonGuestProjectAccess("params", "projectId"), safeControllerFunction(ProjectDocsController.listByTask));
projectDocsApiRouter.get("/:docId", verifyNonGuestProjectAccess("params", "projectId"), safeControllerFunction(ProjectDocsController.getById));
projectDocsApiRouter.post("/", verifyNonGuestProjectAccess("params", "projectId"), safeControllerFunction(ProjectDocsController.create));
projectDocsApiRouter.put("/:docId", verifyNonGuestProjectAccess("params", "projectId"), safeControllerFunction(ProjectDocsController.update));
projectDocsApiRouter.delete("/:docId", verifyNonGuestProjectAccess("params", "projectId"), safeControllerFunction(ProjectDocsController.remove));
projectDocsApiRouter.put("/:docId/tasks", verifyNonGuestProjectAccess("params", "projectId"), safeControllerFunction(ProjectDocsController.updateTasks));

export default projectDocsApiRouter;
