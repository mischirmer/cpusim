import { test, expect, type Page } from "@playwright/test";

async function setCycle(page: Page, value: string) {
  await page.getByLabel("Takt auswählen").evaluate((el, v) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
    setter.call(el, v);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }, value);
}

test("Hauptablauf: Pipeline, Stall, Forwarding, Sprung und Register", async ({ page }) => {
  await page.goto("/");

  // Pipeline und Statistik werden gerendert
  await expect(page.getByTestId("pipeline")).toBeVisible();
  await expect(page.getByTestId("statistics-view")).toContainText("Ausgeführte");

  // RAW-Abhängigkeit: ein Stall-Zelle ist in der Pipeline sichtbar
  await page.getByTestId("example-select").selectOption("raw");
  await expect(page.locator("td.stall").first()).toBeVisible();

  // Zum Stall-Takt (4) navigieren -> deutsche Erklärung
  await setCycle(page, "4");
  await expect(page.getByTestId("cycle-indicator")).toContainText("Takt 4");
  await expect(page.getByTestId("explanation-panel")).toContainText("Stall");

  // Mit aktivem Forwarding (Forwarding-Beispiel) wird der Toggle automatisch
  // aktiviert und die weitergeleiteten Operanden werden erklärt.
  await page.getByTestId("example-select").selectOption("raw-forwarding");
  await expect(page.getByTestId("forwarding-toggle")).toBeChecked();
  await setCycle(page, "5");
  await expect(page.getByTestId("explanation-panel")).toContainText("Forwarding");

  // Beispiel mit genommenem Sprung: verworfene Instruktionen sichtbar + Erklärung
  await page.getByTestId("example-select").selectOption("branch-flush");
  await expect(page.locator("td.flush").first()).toBeVisible();

  // Registerwerte werden gerendert und sind mit dem Takt verknüpft
  await expect(page.getByTestId("register-cell").first()).toBeVisible();
});

test("Speicher: Editor, Wort-Lesen Big-Endian und Store-Hervorhebung", async ({ page }) => {
  await page.goto("/");

  // Speicher-Beispiel laden und Editor anzeigen
  await page.getByTestId("example-select").selectOption("memory");
  await expect(page.getByTestId("memory-editor")).toContainText("Initialer Speicher");
  await expect(page.getByTestId("memory-view")).toBeVisible();

  // Eintrag hinzufügen und validieren -> erscheint im Speicher-Panel
  await page.getByText("Eintrag hinzufügen").click();
  const rows = page.getByTestId("memory-row");
  const lastRow = rows.last();
  await lastRow.getByLabel("Adresse").fill("0x2000");
  await lastRow.getByLabel("Wert").fill("0xAB");
  await expect(page.getByTestId("memory-view")).toContainText("0xAB");

  // Zum Takt der ldw-Ausführung navigieren und Big-Endian-Erklärung prüfen
  await setCycle(page, "9");
  await expect(page.getByTestId("memory-explain")).toContainText("ldw liest");
  await expect(page.getByTestId("memory-explain")).toContainText("0x12");
  await expect(page.getByTestId("memory-explain")).toContainText("0x34");
  await expect(page.getByTestId("memory-explain")).toContainText("0x1234");
});
