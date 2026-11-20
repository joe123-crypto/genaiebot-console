import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ adc: vi.fn(() => "adc"), cert: vi.fn(() => "cert"), initialize: vi.fn(() => "app"), getAuth: vi.fn(() => "auth") }));
vi.mock("firebase-admin/app", () => ({ applicationDefault: mocks.adc, cert: mocks.cert, getApps: () => [], initializeApp: mocks.initialize }));
vi.mock("firebase-admin/auth", () => ({ getAuth: mocks.getAuth }));
import { appOrigin, authEmulatorEnabled, firebaseAdminAuth } from "@/src/lib/firebase-admin";
beforeEach(() => {
  vi.clearAllMocks();
  for (const key of ["FIREBASE_CLIENT_EMAIL", "FIREBASE_PRIVATE_KEY", "FIREBASE_AUTH_EMULATOR_HOST", "NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_URL"]) vi.stubEnv(key, "");
  vi.stubEnv("NODE_ENV", "development"); vi.stubEnv("APP_ORIGIN", "http://localhost:3000");
  vi.stubEnv("FIREBASE_PROJECT_ID", "test-project"); vi.stubEnv("NEXT_PUBLIC_FIREBASE_PROJECT_ID", "test-project");
});
afterEach(() => vi.unstubAllEnvs());
describe("Firebase configuration boundaries", () => {
  it("supports ADC without publishing credentials", () => { expect(firebaseAdminAuth()).toBe("auth"); expect(mocks.adc).toHaveBeenCalledOnce(); });
  it("converts literal PEM newlines and rejects partial credentials", () => {
    vi.stubEnv("FIREBASE_CLIENT_EMAIL", "auth@test-project.iam.gserviceaccount.com"); expect(() => firebaseAdminAuth()).toThrow();
    vi.stubEnv("FIREBASE_PRIVATE_KEY", "line1\\nline2"); firebaseAdminAuth();
    expect(mocks.cert).toHaveBeenCalledWith({ projectId: "test-project", clientEmail: "auth@test-project.iam.gserviceaccount.com", privateKey: "line1\nline2" });
  });
  it("rejects missing and mismatched project IDs", () => {
    vi.stubEnv("FIREBASE_PROJECT_ID", "other-project"); expect(() => firebaseAdminAuth()).toThrow();
    vi.stubEnv("FIREBASE_PROJECT_ID", ""); expect(() => firebaseAdminAuth()).toThrow(); expect(mocks.initialize).not.toHaveBeenCalled();
  });
  it("allows only explicitly matched loopback emulators in development", () => {
    expect(authEmulatorEnabled()).toBe(false);
    vi.stubEnv("FIREBASE_AUTH_EMULATOR_HOST", "127.0.0.1:9099"); expect(() => authEmulatorEnabled()).toThrow();
    vi.stubEnv("NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_URL", "http://127.0.0.1:9099"); expect(authEmulatorEnabled()).toBe(true);
    vi.stubEnv("NODE_ENV", "production"); expect(() => firebaseAdminAuth()).toThrow(); expect(() => appOrigin()).toThrow();
    vi.stubEnv("NODE_ENV", "development"); vi.stubEnv("FIREBASE_AUTH_EMULATOR_HOST", "remote.example:9099"); expect(() => authEmulatorEnabled()).toThrow();
  });
  it("requires an exact origin and production HTTPS", () => {
    expect(appOrigin()).toBe("http://localhost:3000");
    vi.stubEnv("APP_ORIGIN", "https://console.example/path"); expect(() => appOrigin()).toThrow();
    vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("APP_ORIGIN", "http://console.example"); expect(() => appOrigin()).toThrow();
    vi.stubEnv("APP_ORIGIN", "https://console.example"); expect(appOrigin()).toBe("https://console.example");
  });
});
