import Image from "@tiptap/extension-image";

/**
 * 正文图像。
 *
 * 宽高交给所在栏（CSS `width: 100%`，高度自动），所以渲染时丢掉图片自带的
 * 像素宽高，避免宽图按原始像素撑开便签。
 */
export const NoteImage = Image.extend({
  renderHTML({ HTMLAttributes }) {
    const { width: _width, height: _height, ...rest } = HTMLAttributes;
    return ["img", rest];
  },
});
