const { test, expect } = require("@playwright/test")
const { spawn } = require("node:child_process")
const http = require("node:http")

const SNAPSHOT_KEY = "koreansim.experiment.snapshots.v1"
const BASE_URL = "http://127.0.0.1:5173"
let server

test.beforeAll(async () => {
  server = spawn(
    process.execPath,
    ["frontend/node_modules/vite/bin/vite.js", "frontend", "--host", "127.0.0.1", "--port", "5173", "--strictPort"],
    { cwd: process.cwd(), stdio: "ignore" },
  )
  await waitForServer(BASE_URL)
})

test.afterAll(async () => {
  if (!server?.pid) return
  if (process.platform === "win32") {
    await new Promise((resolve) => {
      spawn("taskkill", ["/pid", String(server.pid), "/T", "/F"], { stdio: "ignore" }).once("exit", resolve)
    })
  } else {
    server.kill("SIGTERM")
  }
})

test("loads a saved pivot snapshot into the data-only dashboard", async ({ page }) => {
  const snapshot = {
    id: "snapshot-e2e",
    createdAt: "2026-06-01T00:00:00.000Z",
    name: "라운드트립",
    settings: { nAgents: 1, repeatCount: 1, modelProvider: "openai", modelName: "gpt-5-mini" },
    slots: [{ id: "A", presetId: "", policy: "청년 월세 한시 지원" }],
    structuredPolicy: {
      policy_name: { value: "청년 월세 한시 지원", source: "stated" },
      apply_method: { value: "앱 신청", source: "inferred" },
    },
    results: [
      {
        slotId: "A",
        presetId: "",
        total: { support: 0, oppose: 1, neutral: 0 },
        responses: [
          {
            agent_id: 0,
            age: 27,
            gender: "female",
            province: "경기",
            district: "파주시",
            occupation: "무직",
            family_type: "3세대 가구",
            region_group: "capital",
            stance: "oppose",
            rationale: "가족과 사는 청년은 빠질 수 있습니다.",
            blind_spot: "가구 조건이 좁다",
            expected_complaint: "나는 대상자인가요?",
          },
        ],
        aggregate: {
          total: { support: 0, oppose: 1, neutral: 0 },
          by_age: {},
          by_gender: {},
          by_region: {},
          concern_clusters: [],
          support_clusters: [],
          blind_spot_raw: [{ blind_spot: "가구 조건이 좁다", affected_group: "가족 동거 청년" }],
          blind_spot_clusters: [
            {
              affected_group: "가족 동거 청년",
              short_title: "가족 동거 청년",
              count: 1,
              denominator: 1,
              representative_quote: "가구 조건이 좁다",
              inferred_based: false,
              agent_ids: [0],
              blind_spot_examples: ["가구 조건이 좁다"],
            },
          ],
          complaint_clusters: [
            {
              count: 1,
              denominator: 1,
              representative_quote: "나는 대상자인가요?",
              inferred_based: false,
              agent_ids: [0],
            },
          ],
          affected_group_clusters: [
            {
              affected_group: "가족 동거 청년",
              count: 1,
              denominator: 1,
              representative_quote: "가족 동거 청년",
              inferred_based: false,
              agent_ids: [0],
            },
          ],
          reframing_list: [],
        },
      },
    ],
  }

  await page.addInitScript(
    ({ key, value }) => window.localStorage.setItem(key, JSON.stringify([value])),
    { key: SNAPSHOT_KEY, value: snapshot },
  )
  await page.goto(BASE_URL)

  await page.getByRole("button", { name: "불러오기" }).last().click()

  await expect(page.getByText("입장 분포")).toBeVisible()
  await expect(page.getByRole("button", { name: /나는 대상자인가요/ })).toBeVisible()
  await page.getByRole("button", { name: "정책 요약 펼치기" }).click()
  await expect(page.getByText("앱 신청")).toBeVisible()
  await expect(page.getByText(/27세/)).toBeVisible()
})

function waitForServer(url) {
  const deadline = Date.now() + 15000
  return new Promise((resolve, reject) => {
    const probe = () => {
      http
        .get(url, (response) => {
          response.resume()
          if (response.statusCode && response.statusCode < 500) {
            resolve()
          } else {
            retry()
          }
        })
        .on("error", retry)
    }
    const retry = () => {
      if (Date.now() > deadline) {
        reject(new Error(`Timed out waiting for ${url}`))
      } else {
        setTimeout(probe, 250)
      }
    }
    probe()
  })
}
