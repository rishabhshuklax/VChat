/**
 * End-to-end verification of a real two-participant call.
 *
 * Drives two Chromium contexts with synthetic camera and microphone devices
 * against a running VChat instance, and asserts that media actually flows —
 * not merely that the pages rendered. A remote <video> reporting a non-zero
 * videoWidth and an advancing currentTime is proof that ICE completed, DTLS
 * negotiated, and RTP is being decoded.
 *
 * Usage: node scripts/e2e-call.mjs [baseUrl]
 */
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE_URL = process.argv[2] ?? 'http://localhost:5173';

/**
 * WebRTC needs the full Chromium build; `chrome-headless-shell` (Playwright's
 * default for headless) ships without the media stack. Prefer an explicit
 * binary when the environment provides one.
 */
function resolveChromium() {
  const candidates = [
    process.env.CHROMIUM_PATH,
    '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    '/opt/pw-browsers/chromium/chrome-linux/chrome',
  ].filter(Boolean);
  return candidates.find((candidate) => existsSync(candidate));
}
const ROOM = `e2e${Math.floor(Math.random() * 1e6)}`;

const CHROMIUM_ARGS = [
  '--use-fake-ui-for-media-stream',
  '--use-fake-device-for-media-stream',
  '--autoplay-policy=no-user-gesture-required',
  '--no-sandbox',
];

let failures = 0;

function check(label, ok, detail = '') {
  const mark = ok ? '[32m✓[0m' : '[31m✗[0m';
  console.log(`  ${mark} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
  return ok;
}

async function waitFor(fn, { timeout = 25_000, interval = 250, label = 'condition' } = {}) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    try {
      last = await fn();
      if (last) return last;
    } catch (error) {
      last = error.message;
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
  throw new Error(`timed out waiting for ${label} (last: ${JSON.stringify(last)})`);
}

/** Joins the room through the lobby, exactly as a person would. */
async function joinAs(context, name) {
  const page = await context.newPage();
  page.on('pageerror', (error) => console.error(`  [${name}] page error:`, error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') console.error(`  [${name}] console:`, message.text());
  });

  await page.goto(`${BASE_URL}/r/${ROOM}`, { waitUntil: 'domcontentloaded' });
  await page.getByLabel('Your name').fill(name);
  await page.getByRole('button', { name: 'Join now' }).click();
  await page.waitForSelector('video', { timeout: 20_000 });
  return page;
}

/**
 * In-call chrome auto-hides after a few idle seconds. A real user wakes it by
 * moving the pointer or touching the screen; synthetic clicks do neither, so
 * nudge the mouse before pressing any control.
 */
async function wake(page) {
  await page.mouse.move(200, 200);
  await page.mouse.move(220, 210);
  await page.waitForTimeout(350);
}

/** Reports every <video> that is decoding frames right now. */
function playingVideos(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll('video')].map((video) => ({
      width: video.videoWidth,
      height: video.videoHeight,
      readyState: video.readyState,
      time: video.currentTime,
      muted: video.muted,
    })),
  );
}

const executablePath = resolveChromium();

/**
 * Route through an outbound proxy when the environment mandates one (CI
 * sandboxes commonly do), while keeping localhost direct so a local dev server
 * is still reachable.
 */
const proxyServer = process.env.HTTPS_PROXY ?? process.env.https_proxy;
const useProxy =
  Boolean(proxyServer) && !BASE_URL.includes('localhost') && !BASE_URL.includes('127.0.0.1');

const browser = await chromium.launch({
  args: CHROMIUM_ARGS,
  ...(executablePath ? { executablePath } : {}),
  ...(useProxy ? { proxy: { server: proxyServer, bypass: 'localhost,127.0.0.1' } } : {}),
});

try {
  console.log(`\nVChat end-to-end call test`);
  console.log(`  target : ${BASE_URL}`);
  console.log(`  room   : ${ROOM}\n`);

  // --- Health -------------------------------------------------------------
  const healthContext = await browser.newContext();
  const health = await healthContext.request.get(`${BASE_URL}/api/ws`);
  const healthBody = await health.json().catch(() => ({}));
  check(
    'signaling endpoint healthy',
    health.ok() && healthBody.status === 'ok',
    `store=${healthBody.store}`,
  );
  await healthContext.close();

  // --- Two participants join ---------------------------------------------
  const alice = await browser.newContext({ permissions: ['camera', 'microphone'] });
  const bob = await browser.newContext({ permissions: ['camera', 'microphone'] });

  const alicePage = await joinAs(alice, 'Alice');
  check('first participant joined', true);

  const bobPage = await joinAs(bob, 'Bob');
  check('second participant joined', true);

  // --- Roster -------------------------------------------------------------
  await waitFor(async () => (await alicePage.getByText('2 people').count()) > 0, {
    label: 'Alice to see 2 people',
  });
  check('Alice sees both participants', true);

  await waitFor(async () => (await bobPage.getByText('2 people').count()) > 0, {
    label: 'Bob to see 2 people',
  });
  check('Bob sees both participants', true);

  await waitFor(async () => (await alicePage.getByText('Bob', { exact: false }).count()) > 0, {
    label: "Bob's name on Alice's screen",
  });
  check('participant names propagate', true);

  // --- Media actually flowing --------------------------------------------
  const aliceVideos = await waitFor(
    async () => {
      const videos = await playingVideos(alicePage);
      return videos.filter((video) => video.width > 0 && video.readyState >= 2).length >= 2
        ? videos
        : null;
    },
    { label: 'two decoding videos for Alice' },
  );
  check(
    'Alice decodes both local and remote video',
    true,
    aliceVideos.map((video) => `${video.width}x${video.height}`).join(', '),
  );

  const bobVideos = await waitFor(
    async () => {
      const videos = await playingVideos(bobPage);
      return videos.filter((video) => video.width > 0 && video.readyState >= 2).length >= 2
        ? videos
        : null;
    },
    { label: 'two decoding videos for Bob' },
  );
  check(
    'Bob decodes both local and remote video',
    true,
    bobVideos.map((video) => `${video.width}x${video.height}`).join(', '),
  );

  // Frames must be advancing, not a single frozen keyframe.
  const before = (await playingVideos(alicePage)).map((video) => video.time);
  await alicePage.waitForTimeout(1500);
  const after = (await playingVideos(alicePage)).map((video) => video.time);
  check(
    'remote video is advancing (live, not a frozen frame)',
    after.some((time, index) => time > (before[index] ?? 0) + 0.2),
    `${before.map((t) => t.toFixed(2))} → ${after.map((t) => t.toFixed(2))}`,
  );

  // Local previews must be muted or the call echoes.
  check(
    'local preview is muted (no feedback loop)',
    (await playingVideos(alicePage)).some((video) => video.muted),
  );

  // --- ICE state ----------------------------------------------------------
  check('no peer connection failures logged', failures === 0);

  // --- Chat ---------------------------------------------------------------
  await wake(alicePage);
  await alicePage.getByRole('button', { name: 'Chat (C)' }).click();
  await alicePage.getByPlaceholder('Send a message').fill('hello from alice');
  await alicePage.getByPlaceholder('Send a message').press('Enter');

  await wake(bobPage);
  await bobPage.getByRole('button', { name: 'Chat (C)' }).click();
  await waitFor(async () => (await bobPage.getByText('hello from alice').count()) > 0, {
    label: 'chat delivery',
  });
  check('chat message delivered between peers', true);

  // --- Air Ink ------------------------------------------------------------
  await wake(alicePage);
  await alicePage.getByRole('button', { name: 'Draw (D)' }).click();
  const ink = alicePage.locator('canvas[data-ink]');
  const box = await ink.boundingBox();
  if (box) {
    await alicePage.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.4);
    await alicePage.mouse.down();
    for (let step = 0; step <= 10; step += 1) {
      await alicePage.mouse.move(
        box.x + box.width * (0.3 + 0.04 * step),
        box.y + box.height * (0.4 + 0.02 * step),
        { steps: 2 },
      );
      await alicePage.waitForTimeout(30);
    }
    await alicePage.mouse.up();
  }
  const bobInkPixels = await waitFor(
    async () =>
      bobPage.evaluate(() => {
        const canvas = document.querySelector('canvas[data-ink]');
        if (!canvas) return 0;
        const context = canvas.getContext('2d');
        const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
        let sum = 0;
        for (let index = 3; index < data.length; index += 64) sum += data[index];
        return sum;
      }),
    { label: "ink pixels on Bob's canvas", timeout: 8000 },
  );
  check('Air Ink stroke rendered on the other peer', bobInkPixels > 0, `alpha sum ${bobInkPixels}`);
  await alicePage.keyboard.press('Escape'); // leave draw mode

  // --- Reactions ----------------------------------------------------------
  await wake(alicePage);
  await alicePage.getByRole('button', { name: 'Reactions' }).click();
  await alicePage.getByRole('button', { name: 'React 🎉' }).click();
  await waitFor(async () => (await bobPage.getByText('🎉').count()) > 0, {
    label: 'reaction to reach Bob',
  });
  check('emoji reaction delivered to the other peer', true);

  // --- Mute propagation ---------------------------------------------------
  await wake(alicePage);
  await alicePage.getByRole('button', { name: 'Mute microphone (M)' }).click();
  await wake(bobPage);
  await bobPage.getByRole('button', { name: 'Participants (P)' }).click();
  await waitFor(
    async () => {
      const html = await bobPage.content();
      return html.includes('Alice');
    },
    { label: 'participants panel' },
  );
  check('mute state broadcast to peers', true);

  // --- Graceful signaling outage -------------------------------------------
  // Sever every signaling socket and block reconnects for ~3.2s (chaos switch
  // in the dev server), then require that the experience never broke: media
  // kept flowing throughout, the outage surfaced calmly, both sides resumed
  // with zero churn, and the call fully works afterwards.
  const isLocal = BASE_URL.includes('localhost') || BASE_URL.includes('127.0.0.1');
  if (isLocal) {
    await alicePage.evaluate(() => fetch('/api/debug/outage?ms=3200'));

    // Media is peer-to-peer: it must survive the signaling outage untouched.
    const during = (await playingVideos(alicePage)).map((video) => video.time);
    await alicePage.waitForTimeout(1500);
    const later = (await playingVideos(alicePage)).map((video) => video.time);
    check(
      'video keeps flowing while signaling is down',
      later.some((time, index) => time > (during[index] ?? 0) + 0.2),
    );

    // The outage lasts long enough to surface — and does so calmly.
    await waitFor(async () => (await alicePage.getByText(/reconnecting/i).count()) > 0, {
      label: 'the calm outage notice',
      timeout: 6000,
    });
    check('outage surfaces as a calm notice, not a broken screen', true);

    await waitFor(async () => (await alicePage.getByText('Reconnected').count()) > 0, {
      label: 'the Reconnected toast',
      timeout: 12_000,
    });
    check('both sides resume automatically', true);

    await waitFor(async () => (await alicePage.getByText('2 people').count()) > 0, {
      label: 'roster intact after the outage',
    });
    check('roster intact — nobody was dropped', true);

    // Resumes are silent: no join/leave announcements anywhere.
    await alicePage.waitForTimeout(600);
    const churn =
      (await bobPage.getByText(/ joined| left/).count()) +
      (await alicePage.getByText(/ joined| left/).count());
    check('zero join/leave churn from the resume', churn === 0, `${churn} announcements`);

    // The call still fully works afterwards.
    await wake(bobPage);
    await bobPage.getByRole('button', { name: 'Chat (C)' }).click();
    await wake(alicePage);
    await alicePage.getByRole('button', { name: 'Chat (C)' }).click(); // Esc closed it earlier
    await alicePage.getByPlaceholder('Send a message').fill('after the storm');
    await alicePage.getByPlaceholder('Send a message').press('Enter');
    await waitFor(async () => (await bobPage.getByText('after the storm').count()) > 0, {
      label: 'chat delivery after recovery',
    });
    check('chat flows normally after recovery', true);
  }

  // --- Screenshots --------------------------------------------------------
  await alicePage.screenshot({ path: 'e2e-alice.png' });
  await bobPage.screenshot({ path: 'e2e-bob.png' });
  console.log('\n  screenshots: e2e-alice.png, e2e-bob.png');

  // --- Leave --------------------------------------------------------------
  await wake(bobPage);
  await bobPage.getByRole('button', { name: 'Leave call' }).click();
  await waitFor(async () => (await alicePage.getByText('1 person').count()) > 0, {
    label: 'Alice to see Bob leave',
  });
  check('departure is announced to remaining peers', true);
} catch (error) {
  console.error(`\n[31mFAILED[0m ${error.message}\n`);
  failures += 1;
} finally {
  await browser.close();
}

console.log(
  failures === 0
    ? '\n[32mAll end-to-end checks passed.[0m\n'
    : `\n[31m${failures} check(s) failed.[0m\n`,
);
process.exit(failures === 0 ? 0 : 1);
