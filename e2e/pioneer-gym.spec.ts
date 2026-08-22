import { expect, test } from "@playwright/test";

const ACCESS_CODE = "pioneer-e2e";

async function unlock(page: import("@playwright/test").Page) {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Enter the gym." })).toBeVisible();
  await page.getByLabel("Shared access code").fill(ACCESS_CODE);
  await page.getByRole("button", { name: "Enter Pioneer Gym" }).click();
  await expect(page.getByRole("heading", { name: "Train the decision, not the answer." })).toBeVisible();
}

test("a human completes the authenticated Pioneer curriculum journey without a Tambo backend", async ({ page }) => {
  const externalRequests: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.host !== "127.0.0.1:3100") externalRequests.push(request.url());
  });

  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Enter the gym." })).toBeVisible();
  await page.getByLabel("Shared access code").fill("wrong-code");
  await page.getByRole("button", { name: "Enter Pioneer Gym" }).click();
  await expect(page.getByText("The demo access code is invalid.")).toBeVisible();

  await page.getByLabel("Shared access code").fill(ACCESS_CODE);
  await page.getByRole("button", { name: "Enter Pioneer Gym" }).click();
  await expect(page.getByRole("heading", { name: "Train the decision, not the answer." })).toBeVisible();

  await page.getByLabel("What do you want to learn?").fill(
    "Teach me to make short-form product video hierarchy decisions I can defend.",
  );
  await page.getByRole("button", { name: "Build my first rep" }).click();

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
  await expect(page.getByText("transfer shown", { exact: true })).toBeVisible();
  await expect(page.getByText("Tambo: registered-component renderer only")).toBeVisible();
  await page.getByRole("button", { name: "Start another session" }).click();
  await expect(page.getByRole("heading", { name: "What do you want to learn next?" })).toBeVisible();
  expect(externalRequests).toEqual([]);
});

test("invalid dynamic props stop before Tambo and recover only through the certified fallback", async ({ page }) => {
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
  await page.getByRole("button", { name: "Build my first rep" }).click();
  await expect(page.getByText("Codex selected invalid component props.", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Ask Codex for a safe path" }).click();
  await expect(page.getByRole("heading", { name: "The dynamic rep could not be rendered safely" })).toBeVisible();
  await expect(page.getByText("SEPARATELY VALIDATED FALLBACK")).toBeVisible();
  expect(gymResponseCount).toBe(2);
});
