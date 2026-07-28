import { copyFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const toolRoot = join(root, ".android-toolchain");
const jdkRoot = join(toolRoot, "jdk");
const bundledSdkRoot = join(toolRoot, "android-sdk");
const androidRoot = join(root, "android");

const jdkFolder = existsSync(jdkRoot)
  ? readdirSync(jdkRoot, { withFileTypes: true }).find((entry) => entry.isDirectory())
  : null;
const bundledJavaHome = jdkFolder ? join(jdkRoot, jdkFolder.name) : "";
const javaHome = [
  process.env.JAVA_HOME,
  bundledJavaHome,
  process.env.ProgramFiles
    ? join(process.env.ProgramFiles, "Android", "Android Studio", "jbr")
    : "",
  process.env.LOCALAPPDATA
    ? join(process.env.LOCALAPPDATA, "Programs", "Android Studio", "jbr")
    : "",
].find((candidate) => candidate && existsSync(join(candidate, "bin", "java.exe"))) || "";
const sdkRoot = [
  process.env.ANDROID_HOME,
  process.env.ANDROID_SDK_ROOT,
  bundledSdkRoot,
  process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, "Android", "Sdk") : "",
].find((candidate) => candidate && existsSync(join(candidate, "platform-tools"))) || "";

if (!javaHome || !existsSync(join(javaHome, "bin", "java.exe"))) {
  throw new Error(
    "JDK 21 was not found. Set JAVA_HOME before building Android.",
  );
}

if (!existsSync(sdkRoot) || !existsSync(join(sdkRoot, "platform-tools"))) {
  throw new Error(
    "Android SDK was not found. Set ANDROID_HOME or ANDROID_SDK_ROOT before building Android.",
  );
}

const gradleUserHome = process.env.GRADLE_USER_HOME;
if (gradleUserHome) mkdirSync(gradleUserHome, { recursive: true });

const gradle = spawnSync(
  join(androidRoot, "gradlew.bat"),
  ["assembleDebug", "--stacktrace"],
  {
    cwd: androidRoot,
    env: {
      ...process.env,
      JAVA_HOME: javaHome,
      ANDROID_HOME: sdkRoot,
      ANDROID_SDK_ROOT: sdkRoot,
      ...(gradleUserHome ? { GRADLE_USER_HOME: gradleUserHome } : {}),
    },
    shell: true,
    stdio: "inherit",
  },
);

if (gradle.status !== 0) {
  process.exit(gradle.status ?? 1);
}

const outputRoot = join(androidRoot, "app", "build", "outputs", "apk", "debug");
const apk = readdirSync(outputRoot)
  .filter((name) => name.endsWith(".apk") && name.includes("x86_64"))
  .map((name) => join(outputRoot, name))[0]
  ?? join(outputRoot, "app-debug.apk");

if (!existsSync(apk)) {
  throw new Error(`Android APK was not found in ${outputRoot}.`);
}

const artifactRoot = join(root, "release");
mkdirSync(artifactRoot, { recursive: true });
const destination = join(artifactRoot, "Metro-Studio-1.0.0-Android-x86_64.apk");
copyFileSync(apk, destination);
console.log(`Android APK: ${destination} (from ${basename(apk)})`);
