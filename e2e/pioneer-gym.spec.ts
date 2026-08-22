import { expect, test } from "@playwright/test";

const ACCESS_CODE = "pioneer-e2e";

async function unlock(page: import("@playwright/test").Page) {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Ready to practice?" })).toBeVisible();
  await page.getByLabel("Shared access code").fill(ACCESS_CODE);
  await page.getByRole("button", { name: "Enter Pioneer Gym" }).click();
  await expect(page.getByRole("heading", { name: "What do you want to learn?" })).toBeVisible();
}

test("a human completes the authenticated Pioneer curriculum journey through the local renderer", async ({ page }) => {
  const externalRequests: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.host !== "127.0.0.1:3100") externalRequests.push(request.url());
  });

  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Ready to practice?" })).toBeVisible();
  await page.getByLabel("Shared access code").fill("wrong-code");
  await page.getByRole("button", { name: "Enter Pioneer Gym" }).click();
  await expect(page.getByText("The demo access code is invalid.")).toBeVisible();

  await page.getByLabel("Shared access code").fill(ACCESS_CODE);
  await page.getByRole("button", { name: "Enter Pioneer Gym" }).click();
  await expect(page.getByRole("heading", { name: "What do you want to learn?" })).toBeVisible();

  await page.getByLabel("What do you want to learn?").fill(
    "Teach me to make short-form product video hierarchy decisions I can defend.",
  );
  await page.getByRole("button", { name: "Start practicing" }).click();

  await expect(page.getByRole("heading", { name: /Which frame makes the product decision/ })).toBeVisible();
  await page.getByRole("radio", { name: /Frame B/ }).click();
  await page.getByRole("button", { name: "Clear focal order" }).click();
  await page.getByRole("button", { name: "medium", exact: true }).click();
  await page.getByRole("button", { name: "Commit response" }).click();

  await expect(page.getByRole("heading", { name: "You found the focal path" })).toBeVisible();
  await page.getByRole("button", { name: "Find my next edge" }).click();

  await expect(page.getByRole("heading", { name: "Build the reading order in a new format" })).toBeVisible();
  await page.getByLabel("Why does this order answer the brief?").fill(
    "The promise earns attention first, proof makes it credible, and the action closes the path.",
  );
  await page.getByRole("button", { name: "medium", exact: true }).click();
  await page.getByRole("button", { name: "Submit held-out transfer" }).click();

  await expect(page.getByRole("heading", { name: "The decision transferred to a changed action" })).toBeVisible();
  await expect(
    page.getByRole("listitem", { name: "5. Transfer: complete" }),
  ).toBeVisible();
  await expect(
    page.getByText("This is transfer evidence, not a guarantee of learning."),
  ).toBeVisible();
  await expect(page.getByText(/tambo/i)).toHaveCount(0);
  await page.getByRole("button", { name: "Start another session" }).click();
  await expect(page.getByRole("heading", { name: "What do you want to learn next?" })).toBeVisible();
  expect(externalRequests).toEqual([]);
});

test("invalid dynamic props stop before the local renderer and recover only through the certified fallback", async ({ page }) => {
  await unlock(page);

  let gymResponseCount = 0;
  await page.route("**/api/gym", async (route) => {
    const response = await route.fetch();
    gymResponseCount += 1;
    if (gymResponseCount !== 1) {
      await route.fulfill({ response });
      return;
    }

    const payload = (await response.json()) as {
      command: { component: { props: Record<string, unknown> } };
    };
    payload.command.component.props.variants = [];
    await route.fulfill({ response, json: payload });
  });

  await page.getByLabel("What do you want to learn?").fill("Teach me visual hierarchy.");
  await page.getByRole("button", { name: "Start practicing" }).click();
  await expect(page.getByText("Codex selected invalid component props.", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Ask Codex for a safe path" }).click();
  await expect(page.getByRole("heading", { name: "The dynamic rep could not be rendered safely" })).toBeVisible();
  await expect(page.getByText("SEPARATELY VALIDATED FALLBACK")).toBeVisible();
  expect(gymResponseCount).toBe(2);
});

test("independent learner pages start distinct gym sessions", async ({ browser }) => {
  const firstContext = await browser.newContext();
  const secondContext = await browser.newContext();
  const first = await firstContext.newPage();
  const second = await secondContext.newPage();
  const sessionIds: string[] = [];

  await unlock(first);
  await secondContext.addCookies(await firstContext.cookies());
  await second.goto("/");
  await expect(second.getByRole("heading", { name: "What do you want to learn?" })).toBeVisible();

  for (const page of [first, second]) {
    page.on("request", (request) => {
      if (request.method() !== "POST" || !request.url().endsWith("/api/gym")) return;
      const payload = request.postDataJSON() as { sessionId?: unknown };
      if (typeof payload.sessionId === "string") sessionIds.push(payload.sessionId);
    });
    await page.route("**/api/gym", (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "Session ID captured by browser test." }),
      }),
    );
    await page.getByLabel("What do you want to learn?").fill("Teach me visual hierarchy.");
  }

  await Promise.all([
    first.getByRole("button", { name: "Start practicing" }).click(),
    second.getByRole("button", { name: "Start practicing" }).click(),
  ]);
  await expect.poll(() => sessionIds.length).toBe(2);
  expect(new Set(sessionIds).size).toBe(2);
  await firstContext.close();
  await secondContext.close();
});

test("the gated sample lesson exposes a real native-video asset", async ({ page }) => {
  const externalRequests: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.host !== "127.0.0.1:3100") externalRequests.push(request.url());
  });

  await page.goto("/lesson");
  await expect(page.getByRole("heading", { name: "Ready to practice?" })).toBeVisible();
  await page.getByLabel("Shared access code").fill(ACCESS_CODE);
  await page.getByRole("button", { name: "Enter Pioneer Gym" }).click();
  await expect(page.getByRole("heading", { name: "How the dot-com bubble formed" })).toBeVisible();

  const video = page.locator("video[controls]");
  await expect(video).toHaveCount(1);
  await expect(video.locator("source")).toHaveAttribute(
    "src",
    "/media/dotcom-lesson.mp4",
  );
  await expect(video.locator("source")).toHaveAttribute("type", "video/mp4");

  const media = await page.request.get("/media/dotcom-lesson.mp4");
  expect(media.status()).toBe(200);
  expect(media.headers()["content-type"]).toContain("video/mp4");
  await expect(page.getByText(/tambo/i)).toHaveCount(0);
  expect(externalRequests).toEqual([]);
});
