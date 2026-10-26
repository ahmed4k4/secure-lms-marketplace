import { describe, expect, it } from "vitest";
import { courseCreateSchema, playbackSchema } from "@/lib/schemas";
describe("course schema",()=>{it("accepts safe slug and bilingual titles",()=>expect(courseCreateSchema.safeParse({slug:"intro-to-code",titleEn:"Intro to Code",titleAr:"مقدمة للبرمجة"}).success).toBe(true));it("rejects path injection in slug",()=>expect(courseCreateSchema.safeParse({slug:"../admin",titleEn:"Intro",titleAr:"مقدمة"}).success).toBe(false));it("rejects duplicate-style uppercase/space slug",()=>expect(courseCreateSchema.safeParse({slug:"Intro to Code",titleEn:"Intro",titleAr:"مقدمة"}).success).toBe(false));});
describe("playback schema",()=>{it("requires a UUID",()=>expect(playbackSchema.safeParse({lessonId:"not-a-uuid"}).success).toBe(false));});
