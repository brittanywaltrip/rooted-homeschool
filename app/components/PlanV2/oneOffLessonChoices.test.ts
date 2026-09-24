import assert from "node:assert/strict";
import test from "node:test";
import { reusableOneOffLessons } from "./oneOffLessonChoices.ts";

test("reuses a family's own subjects and titles without offering orphaned curriculum rows", () => {
  const choices = reusableOneOffLessons([
    { title: "Nature Study · Observe the monarch butterfly" },
    { title: "Nature Study · Observe the monarch butterfly" },
    { title: "Happy Cheetah — Lesson 12" },
    { title: "Poetry recitation" },
  ]);
  assert.deepEqual(choices, [
    { subject: "Nature Study", title: "Observe the monarch butterfly", label: "Nature Study · Observe the monarch butterfly" },
    { subject: "", title: "Poetry recitation", label: "Poetry recitation" },
  ]);
});
