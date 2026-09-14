import { z } from "zod";

const identifier = z.string().regex(/^[A-Za-z0-9-]+$/);
export const catalogSchema = z.object({
  themes: z.object({ colors: z.array(identifier).nonempty(), shapes: z.array(identifier).nonempty() }),
  entries: z.array(z.object({
    name: identifier,
    stories: z.array(z.object({
      id: identifier,
      url: z.string().regex(/^\/(?:component|tokens)\/[a-z0-9-]+#story-[a-z0-9-]+$/),
    })).nonempty(),
  })).nonempty(),
});

export function captureCases(catalog: z.infer<typeof catalogSchema>) {
  return catalog.entries.flatMap((entry) => entry.stories.flatMap((story) =>
    catalog.themes.colors.flatMap((color) => catalog.themes.shapes.map((shape) => ({
      url: story.url,
      selector: new URL(story.url, "http://localhost").hash,
      color, shape,
      filename: `${entry.name}--${story.id}--${color}--${shape}.png`,
    }))),
  ));
}
