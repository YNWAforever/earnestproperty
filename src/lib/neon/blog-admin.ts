import { createServerFn } from "@tanstack/react-start";
import { getRequest, setResponseHeader } from "@tanstack/react-start/server";
import { z } from "zod";
import { callStaffServerFn } from "./staff-server-fn";
import { blogRequest, parseBlogRequest } from "./blog-response";
import {
  articleQuerySchema,
  saveArticleSchema,
  blogSettingsSchema,
  blogCategorySchema,
  articleIdSchema,
} from "../blog/write-schemas";
import type { ArticleQuery, SaveArticleCommand, BlogSettings, BlogCategory } from "../blog/types";
const server = () => import("./blog-admin.server");
function privateHeaders() {
  setResponseHeader("Cache-Control", "private, no-store");
  setResponseHeader("X-Robots-Tag", "noindex, nofollow");
}
const listServer = createServerFn({ method: "GET" })
  .inputValidator((data: ArticleQuery) => parseBlogRequest(() => articleQuerySchema.parse(data)))
  .handler(async ({ data }) => {
    privateHeaders();
    return blogRequest(async () => (await server()).listBlogArticles(data, getRequest()));
  });
const saveServer = createServerFn({ method: "POST" })
  .inputValidator((data: SaveArticleCommand) =>
    parseBlogRequest(() => saveArticleSchema.parse(data)),
  )
  .handler(async ({ data }) => {
    privateHeaders();
    return blogRequest(async () => (await server()).saveBlogArticle(data, getRequest()));
  });
const settingsServer = createServerFn({ method: "POST" })
  .inputValidator((data: BlogSettings) => parseBlogRequest(() => blogSettingsSchema.parse(data)))
  .handler(async ({ data }) => {
    privateHeaders();
    return blogRequest(async () => (await server()).saveBlogSettings(data, getRequest()));
  });
const categoryServer = createServerFn({ method: "POST" })
  .inputValidator((data: Omit<BlogCategory, "id"> & { id?: string }) =>
    parseBlogRequest(() => blogCategorySchema.parse(data)),
  )
  .handler(async ({ data }) => {
    privateHeaders();
    return blogRequest(async () => (await server()).saveBlogCategory(data, getRequest()));
  });
const stateServer = createServerFn({ method: "GET" })
  .inputValidator((data: Record<string, never>) =>
    parseBlogRequest(() => z.object({}).strict().parse(data)),
  )
  .handler(async () => {
    privateHeaders();
    return blogRequest(async () => (await server()).getBlogAdminState(getRequest()));
  });
const previewServer = createServerFn({ method: "GET" })
  .inputValidator((data: { id: string }) =>
    parseBlogRequest(() => z.object({ id: articleIdSchema }).strict().parse(data)),
  )
  .handler(async ({ data }) => {
    privateHeaders();
    return blogRequest(async () => (await server()).getArticlePreview(data.id, getRequest()));
  });
export const listBlogArticles = async (options: { data: ArticleQuery }) =>
  callStaffServerFn(listServer, options);
export const saveBlogArticle = async (options: { data: SaveArticleCommand }) =>
  callStaffServerFn(saveServer, options);
export const saveBlogSettings = async (options: { data: BlogSettings }) =>
  callStaffServerFn(settingsServer, options);
export const saveBlogCategory = async (options: {
  data: Omit<BlogCategory, "id"> & { id?: string };
}) => callStaffServerFn(categoryServer, options);
export const getBlogAdminState = async () => callStaffServerFn(stateServer, { data: {} });
export const getArticlePreview = async (options: { data: { id: string } }) =>
  callStaffServerFn(previewServer, options);

const categoryOptionsServer = createServerFn({ method: "GET" })
  .inputValidator((data: Record<string, never>) =>
    parseBlogRequest(() => z.object({}).strict().parse(data)),
  )
  .handler(async () => {
    privateHeaders();
    return blogRequest(async () => (await server()).getBlogCategoryOptions(getRequest()));
  });
export const getBlogCategoryOptions = async () =>
  callStaffServerFn(categoryOptionsServer, { data: {} });
