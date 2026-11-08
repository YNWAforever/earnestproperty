import { getSchema } from "@tiptap/core";
import Image from "@tiptap/extension-image";
import StarterKit from "@tiptap/starter-kit";

/** Shared by the future editor, server validator and public renderer. No HTML input. */
export const articleEditorExtensions = [
  StarterKit.configure({
    heading: { levels: [2, 3, 4] },
    codeBlock: false,
    trailingNode: false,
    link: { openOnClick: false, autolink: false, linkOnPaste: false },
  }),
  Image.configure({ inline: false, allowBase64: false }),
];
export const articleEditorSchema = getSchema(articleEditorExtensions);
