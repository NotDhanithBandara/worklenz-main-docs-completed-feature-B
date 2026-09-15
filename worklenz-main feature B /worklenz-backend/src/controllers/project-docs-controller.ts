import db from "../config/db";
import HandleExceptions from "../decorators/handle-exceptions";
import {IWorkLenzRequest} from "../interfaces/worklenz-request";
import {IWorkLenzResponse} from "../interfaces/worklenz-response";
import {ServerResponse} from "../models/server-response";
import WorklenzControllerBase from "./worklenz-controller-base";
import {sanitizePlainText, sanitizeRichTextDescription} from "../shared/utils";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const normalizeTaskIds = (value: unknown): string[] => Array.isArray(value) ? [...new Set(value.filter((id): id is string => typeof id === "string" && UUID_RE.test(id)))] : [];

export default class ProjectDocsController extends WorklenzControllerBase {
  @HandleExceptions()
  public static async list(req: IWorkLenzRequest, res: IWorkLenzResponse): Promise<IWorkLenzResponse> {
    const result = await db.query(
      `SELECT id, project_id, parent_id, title, content, created_by, updated_by, created_at, updated_at
       FROM project_docs WHERE project_id = $1 ORDER BY created_at ASC`,
      [req.params.projectId],
    );
    return res.status(200).send(new ServerResponse(true, result.rows));
  }

  @HandleExceptions()
  public static async getById(req: IWorkLenzRequest, res: IWorkLenzResponse): Promise<IWorkLenzResponse> {
    const result = await db.query(
      `SELECT id, project_id, parent_id, title, content, created_by, updated_by, created_at, updated_at
       FROM project_docs WHERE id = $1 AND project_id = $2`,
      [req.params.docId, req.params.projectId],
    );
    if (!result.rowCount) return res.status(404).send(new ServerResponse(false, null, "Document not found"));

    const links = await db.query(
      `SELECT t.id, t.name, t.task_no, CONCAT((SELECT key FROM projects WHERE id = $2), '-', t.task_no) AS task_key
       FROM project_doc_tasks pdt
       JOIN tasks t ON t.id = pdt.task_id
       WHERE pdt.doc_id = $1 AND t.project_id = $2
       ORDER BY t.task_no`,
      [req.params.docId, req.params.projectId],
    );
    return res.status(200).send(new ServerResponse(true, {...result.rows[0], tasks: links.rows}));
  }

  @HandleExceptions()
  public static async create(req: IWorkLenzRequest, res: IWorkLenzResponse): Promise<IWorkLenzResponse> {
    const title = sanitizePlainText(String(req.body.title || "")).trim();
    if (!title) return res.status(400).send(new ServerResponse(false, null, "Title is required"));

    const parentId = req.body.parent_id || null;
    if (parentId && (!UUID_RE.test(parentId))) {
      return res.status(400).send(new ServerResponse(false, null, "Invalid parent document"));
    }
    if (parentId) {
      const parent = await db.query(
        `SELECT id FROM project_docs WHERE id = $1 AND project_id = $2`,
        [parentId, req.params.projectId],
      );
      if (!parent.rowCount) {
        return res.status(400).send(new ServerResponse(false, null, "Parent document not found in this project"));
      }
    }

    const result = await db.query(
      `INSERT INTO project_docs (project_id, team_id, parent_id, title, content, created_by, updated_by)
       SELECT $1, p.team_id, $2, $3, $4, $5, $5 FROM projects p
       WHERE p.id = $1
       RETURNING id, project_id, parent_id, title, content, created_by, updated_by, created_at, updated_at`,
      [
        req.params.projectId,
        parentId,
        title,
        sanitizeRichTextDescription(req.body.content || ""),
        req.user?.id || null,
      ],
    );
    if (!result.rowCount) return res.status(404).send(new ServerResponse(false, null, "Project not found"));
    return res.status(200).send(new ServerResponse(true, result.rows[0]));
  }

  @HandleExceptions()
  public static async update(req: IWorkLenzRequest, res: IWorkLenzResponse): Promise<IWorkLenzResponse> {
    const title = sanitizePlainText(String(req.body.title || "")).trim();
    if (!title) return res.status(400).send(new ServerResponse(false, null, "Title is required"));

    const parentId = req.body.parent_id || null;
    if (parentId && !UUID_RE.test(parentId)) {
      return res.status(400).send(new ServerResponse(false, null, "Invalid parent document"));
    }
    if (parentId === req.params.docId) {
      return res.status(400).send(new ServerResponse(false, null, "A document cannot be its own parent"));
    }

    const doc = await db.query(
      `SELECT id FROM project_docs WHERE id = $1 AND project_id = $2`,
      [req.params.docId, req.params.projectId],
    );
    if (!doc.rowCount) return res.status(404).send(new ServerResponse(false, null, "Document not found"));

    if (parentId) {
      const parent = await db.query(
        `WITH RECURSIVE ancestors AS (
           SELECT id, parent_id FROM project_docs WHERE id = $1 AND project_id = $3
           UNION ALL
           SELECT d.id, d.parent_id
           FROM project_docs d
           JOIN ancestors a ON d.id = a.parent_id
           WHERE d.project_id = $3
         )
         SELECT EXISTS (SELECT 1 FROM ancestors WHERE id = $2) AS creates_cycle`,
        [parentId, req.params.docId, req.params.projectId],
      );
      if (parent.rows[0]?.creates_cycle) {
        return res.status(400).send(new ServerResponse(false, null, "Cannot move a document below one of its descendants"));
      }

      const parentExists = await db.query(
        `SELECT id FROM project_docs WHERE id = $1 AND project_id = $2`,
        [parentId, req.params.projectId],
      );
      if (!parentExists.rowCount) {
        return res.status(400).send(new ServerResponse(false, null, "Parent document not found in this project"));
      }
    }

    const result = await db.query(
      `UPDATE project_docs SET title = $1, content = $2, parent_id = $3, updated_by = $4, updated_at = NOW()
       WHERE id = $5 AND project_id = $6
       RETURNING id, project_id, parent_id, title, content, created_by, updated_by, created_at, updated_at`,
      [
        title,
        sanitizeRichTextDescription(req.body.content || ""),
        parentId,
        req.user?.id || null,
        req.params.docId,
        req.params.projectId,
      ],
    );
    if (!result.rowCount) return res.status(404).send(new ServerResponse(false, null, "Document not found"));
    return res.status(200).send(new ServerResponse(true, result.rows[0]));
  }

  @HandleExceptions()
  public static async remove(req: IWorkLenzRequest, res: IWorkLenzResponse): Promise<IWorkLenzResponse> {
    const result = await db.query(
      "DELETE FROM project_docs WHERE id = $1 AND project_id = $2 RETURNING id",
      [req.params.docId, req.params.projectId],
    );
    if (!result.rowCount) return res.status(404).send(new ServerResponse(false, null, "Document not found"));
    return res.status(200).send(new ServerResponse(true, null));
  }

  @HandleExceptions()
  public static async updateTasks(req: IWorkLenzRequest, res: IWorkLenzResponse): Promise<IWorkLenzResponse> {
    const rawTaskIds = Array.isArray(req.body.task_ids) ? req.body.task_ids : [];
    if (rawTaskIds.some((id: unknown) => typeof id !== "string" || !UUID_RE.test(id))) {
      return res.status(400).send(new ServerResponse(false, null, "Invalid task id"));
    }
    const taskIds = normalizeTaskIds(rawTaskIds);
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      const doc = await client.query("SELECT id FROM project_docs WHERE id = $1 AND project_id = $2", [
        req.params.docId,
        req.params.projectId,
      ]);
      if (!doc.rowCount) {
        await client.query("ROLLBACK");
        return res.status(404).send(new ServerResponse(false, null, "Document not found"));
      }
      if (taskIds.length) {
        const validTasks = await client.query(
          `SELECT t.id FROM tasks t WHERE t.id = ANY($1::uuid[]) AND t.project_id = $2`,
          [taskIds, req.params.projectId],
        );
        if (validTasks.rowCount !== taskIds.length) {
          await client.query("ROLLBACK");
          return res.status(400).send(new ServerResponse(false, null, "One or more tasks do not belong to this project"));
        }
      }
      await client.query("DELETE FROM project_doc_tasks WHERE doc_id = $1", [req.params.docId]);
      if (taskIds.length) {
        await client.query(
          `INSERT INTO project_doc_tasks (doc_id, task_id) VALUES ${taskIds.map((_, i) => `($1, $${i + 2})`).join(", ")}`,
          [req.params.docId, ...taskIds],
        );
      }
      await client.query("COMMIT");
      return res.status(200).send(new ServerResponse(true, null));
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  @HandleExceptions()
  public static async listByTask(req: IWorkLenzRequest, res: IWorkLenzResponse): Promise<IWorkLenzResponse> {
    const result = await db.query(
      `SELECT d.id, d.title
       FROM project_doc_tasks pdt
       JOIN project_docs d ON d.id = pdt.doc_id
       JOIN tasks t ON t.id = pdt.task_id
       WHERE t.id = $1 AND t.project_id = $2
       ORDER BY d.title`,
      [req.params.taskId, req.params.projectId],
    );
    return res.status(200).send(new ServerResponse(true, result.rows));
  }
}
