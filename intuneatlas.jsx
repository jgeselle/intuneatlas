import React, { useEffect, useMemo, useState } from "react";
import {
  LayoutDashboard,
  Sliders,
  ShieldCheck,
  Smartphone,
  Lightbulb,
  ListChecks,
  Search,
  X,
  Check,
  ChevronRight,
  AlertTriangle,
  AlertCircle,
  CheckCircle2,
  Clock,
  RotateCcw,
  Send,
  Users,
  Compass,
  MessageSquare,
  UserCheck,
  Ban,
  Copy,
} from "lucide-react";

/* ---------------------------------------------------------------- data --- */
/* Configuration settings live inside policies, but the policy is just a
   container. Everything downstream is keyed on the setting itself.        */

const SEED = [
  {
    id: "cfg-1",
    kind: "configuration",
    name: "Windows 11 — Security Baseline (Corp)",
    platform: "Windows",
    profile: "Settings catalog",
    groups: ["All Corporate Windows"],
    devices: 1284,
    ok: 1201,
    updated: "4 Aug 2026",
    settings: [
      {
        id: "s-101", ref: "./Device/Vendor/MSFT/BitLocker/EncryptionMethodByDriveType",
        category: "Encryption",
        name: "BitLocker OS drive encryption method",
        current: "XTS-AES 128-bit",
        recommended: "XTS-AES 256-bit",
        severity: "high",
        why: "256-bit is the baseline standard for corporate-owned devices and adds no measurable boot cost on hardware from the last five years.",
        source: "Microsoft security baseline, Windows 11 24H2",
      },
      {
        id: "s-102", ref: "./Device/Vendor/MSFT/LAPS/Policies/BackupDirectory",
        category: "Local accounts",
        name: "Local Administrator Password Solution (LAPS)",
        current: "Not configured",
        recommended: "Enabled — back up to Entra ID, 30-day rotation",
        severity: "critical",
        why: "83 devices report a shared local admin password. LAPS removes the lateral movement path without changing how the help desk works.",
        source: "CIS Microsoft Windows 11 Benchmark, L1",
      },
      { id: "s-103", ref: "./Device/Vendor/MSFT/Policy/Config/Browser/AllowSmartScreen", category: "Browser", name: "SmartScreen for Microsoft Edge", current: "Enabled", recommended: null },
      {
        id: "s-104", ref: "./Device/Vendor/MSFT/Policy/Config/Browser/PreventSmartScreenPromptOverride",
        category: "Browser",
        name: "Block user override of SmartScreen prompts",
        current: "Not configured",
        recommended: "Enabled",
        severity: "medium",
        why: "Without this, SmartScreen warnings can be clicked through, which is how most drive-by installs land.",
        source: "Microsoft security baseline, Windows 11 24H2",
      },
    ],
  },
  {
    id: "cfg-2",
    kind: "configuration",
    name: "Windows — Defender & ASR Rules",
    platform: "Windows",
    profile: "Endpoint protection",
    groups: ["All Corporate Windows", "Kiosks"],
    devices: 1312,
    ok: 1290,
    updated: "29 Jul 2026",
    settings: [
      {
        id: "s-201", ref: "./Device/Vendor/MSFT/Defender/Configuration/TamperProtection",
        category: "Antivirus",
        name: "Tamper protection",
        current: "Off",
        recommended: "On",
        severity: "critical",
        why: "Tamper protection is off tenant-wide, so any process running as SYSTEM can disable real-time scanning silently.",
        source: "Microsoft Defender for Endpoint hardening guidance",
      },
      {
        id: "s-202", ref: "./Device/Vendor/MSFT/Policy/Config/Defender/AttackSurfaceReductionRules · 9e6c4e1f-7d60-472f-ba1a-a39ef669e4b2",
        category: "Attack surface reduction",
        name: "Block credential stealing from LSASS",
        current: "Audit",
        recommended: "Block",
        severity: "high",
        why: "Audit mode has logged zero false positives across 1,290 devices in 60 days. Safe to enforce.",
        source: "Tenant telemetry, last 60 days",
      },
      { id: "s-203", ref: "./Device/Vendor/MSFT/Policy/Config/Defender/AllowCloudProtection", category: "Antivirus", name: "Cloud-delivered protection", current: "Enabled — high blocking level", recommended: null },
      {
        id: "s-204", ref: "./Device/Vendor/MSFT/Policy/Config/Defender/AllowFullScanRemovableDriveScanning",
        category: "Antivirus",
        name: "Scan removable drives during full scan",
        current: "Disabled",
        recommended: "Enabled",
        severity: "low",
        why: "Low impact, closes the USB gap on the weekly full scan.",
        source: "CIS Microsoft Windows 11 Benchmark, L2",
      },
      { id: "s-205", ref: "./Device/Vendor/MSFT/Policy/Config/Browser/AllowSmartScreen", category: "Browser", name: "SmartScreen for Microsoft Edge", current: "Enabled", recommended: null },
    ],
  },
  {
    id: "cfg-3",
    kind: "configuration",
    name: "Windows — Update Ring: Broad",
    platform: "Windows",
    profile: "Update ring",
    groups: ["All Corporate Windows"],
    devices: 1180,
    ok: 1042,
    updated: "11 Aug 2026",
    settings: [
      {
        id: "s-301", ref: "./Device/Vendor/MSFT/Policy/Config/Update/DeferQualityUpdatesPeriodInDays",
        category: "Windows Update",
        name: "Quality update deferral",
        current: "14 days",
        recommended: "7 days",
        severity: "high",
        why: "Two rings target overlapping groups, so 412 devices get whichever value processes last. Settle on one and scope the pilot ring to a group that does not overlap.",
        source: "Conflict detected in tenant",
      },
      { id: "s-302", ref: "./Device/Vendor/MSFT/Policy/Config/Update/DeferFeatureUpdatesPeriodInDays", category: "Windows Update", name: "Feature update deferral", current: "30 days", recommended: null },
      { id: "s-303", ref: "./Device/Vendor/MSFT/Policy/Config/Update/AllowAutoUpdate", category: "Windows Update", name: "Automatic update behaviour", current: "Auto install at maintenance time", recommended: null },
    ],
  },
  {
    id: "cfg-9",
    kind: "configuration",
    name: "Windows — Update Ring: Pilot",
    platform: "Windows",
    profile: "Update ring",
    groups: ["All Corporate Windows", "IT Pilot"],
    devices: 412,
    ok: 401,
    updated: "11 Aug 2026",
    settings: [
      { id: "s-901b", ref: "./Device/Vendor/MSFT/Policy/Config/Update/DeferQualityUpdatesPeriodInDays", category: "Windows Update", name: "Quality update deferral", current: "2 days", recommended: null },
      { id: "s-902b", ref: "./Device/Vendor/MSFT/Policy/Config/Update/DeferFeatureUpdatesPeriodInDays", category: "Windows Update", name: "Feature update deferral", current: "0 days", recommended: null },
    ],
  },
  {
    id: "cfg-4",
    kind: "configuration",
    name: "Windows — Delivery Optimization",
    platform: "Windows",
    profile: "Settings catalog",
    groups: [],
    devices: 0,
    ok: 0,
    updated: "2 Mar 2026",
    settings: [
      {
        id: "s-401", ref: "./Device/Vendor/MSFT/Policy/Config/DeliveryOptimization/DODownloadMode",
        category: "Windows Update",
        name: "Download mode",
        current: "HTTP only, no peering",
        recommended: "HTTP blended with peering (LAN)",
        severity: "low",
        why: "Branch offices pull every update over the WAN. Peering cuts that traffic roughly in half on sites with more than ten devices.",
        source: "Delivery Optimization guidance",
      },
      { id: "s-402", ref: "./Device/Vendor/MSFT/Policy/Config/DeliveryOptimization/DOMaxCacheAge", category: "Windows Update", name: "Maximum cache age", current: "3 days", recommended: null },
    ],
  },
  {
    id: "cfg-5",
    kind: "configuration",
    name: "macOS — FileVault",
    platform: "macOS",
    profile: "Endpoint protection",
    groups: ["All Corporate Macs"],
    devices: 342,
    ok: 338,
    updated: "18 Jul 2026",
    settings: [
      {
        id: "s-501", ref: "com.apple.MCX · FileVaultRecoveryKeyRotationInDays",
        category: "Encryption",
        name: "Personal recovery key rotation",
        current: "Never",
        recommended: "Every 180 days",
        severity: "medium",
        why: "Keys escrowed in 2024 are still valid. Rotation limits the blast radius if the escrow is ever exposed.",
        source: "Apple platform deployment guide",
      },
      { id: "s-502", ref: "com.apple.security.FDERecoveryKeyEscrow · Location", category: "Encryption", name: "Escrow recovery key to Intune", current: "Enabled", recommended: null },
    ],
  },
  {
    id: "cfg-6",
    kind: "configuration",
    name: "macOS — Gatekeeper & Firewall",
    platform: "macOS",
    profile: "Settings catalog",
    groups: ["All Corporate Macs"],
    devices: 342,
    ok: 342,
    updated: "18 Jul 2026",
    settings: [
      { id: "s-601", ref: "com.apple.systempolicy.control · AllowIdentifiedDevelopers", category: "App control", name: "Allow apps downloaded from", current: "App Store and identified developers", recommended: null },
      { id: "s-602", ref: "com.apple.security.firewall · EnableFirewall", category: "Firewall", name: "Firewall", current: "Enabled, stealth mode on", recommended: null },
    ],
  },
  {
    id: "cfg-7",
    kind: "configuration",
    name: "iOS/iPadOS — Device Restrictions (Corp)",
    platform: "iOS/iPadOS",
    profile: "Device restrictions",
    groups: ["All Corporate iPhones"],
    devices: 508,
    ok: 495,
    updated: "6 Aug 2026",
    settings: [
      {
        id: "s-701", ref: "com.apple.mobiledevice.passwordpolicy · maxInactivity",
        category: "Passcode",
        name: "Require passcode after inactivity",
        current: "15 minutes",
        recommended: "5 minutes",
        severity: "medium",
        why: "Fifteen minutes is long enough that a phone left on a desk is effectively unlocked. Five is the common ceiling for corporate fleets.",
        source: "CIS Apple iOS Benchmark, L1",
      },
      {
        id: "s-702", ref: "com.apple.applicationaccess · allowManagedAppsCloudSync",
        category: "Data protection",
        name: "Block backup of managed apps to iCloud",
        current: "Not configured",
        recommended: "Block",
        severity: "high",
        why: "Managed app data is currently syncing to personal iCloud accounts on 508 devices.",
        source: "Apple platform deployment guide",
      },
      { id: "s-703", ref: "com.apple.applicationaccess · allowScreenShot", category: "Data protection", name: "Block screenshots", current: "Not configured", recommended: null },
    ],
  },
  {
    id: "cfg-8",
    kind: "configuration",
    name: "Android Enterprise — Work Profile",
    platform: "Android",
    profile: "Device restrictions",
    groups: ["BYOD Android"],
    devices: 216,
    ok: 211,
    updated: "22 Jul 2026",
    settings: [
      {
        id: "s-801", ref: "crossProfilePolicies · crossProfileCopyPaste",
        category: "Data protection",
        name: "Copy and paste between work and personal",
        current: "Allowed",
        recommended: "Blocked",
        severity: "high",
        why: "The most common data-leak path on BYOD Android, and the one users complain about least when you close it.",
        source: "Android Enterprise security guidance",
      },
      { id: "s-802", ref: "passwordPolicies · passwordQuality", category: "Passcode", name: "Work profile password required", current: "Enabled", recommended: null },
    ],
  },

  /* ------------------------------------------------------- compliance --- */
  {
    id: "cmp-1",
    kind: "compliance",
    name: "Windows 11 — Corporate Compliance",
    platform: "Windows",
    profile: "Compliance policy",
    groups: ["All Corporate Windows"],
    devices: 1284,
    ok: 1196,
    updated: "1 Aug 2026",
    settings: [
      {
        id: "s-1001", ref: "deviceCompliancePolicy · osMinimumVersion",
        category: "Device health",
        name: "Minimum OS version",
        current: "10.0.22000 (21H2)",
        recommended: "10.0.22631 (23H2)",
        severity: "high",
        why: "21H2 left support in October 2025. 41 devices are still on it and currently pass this policy.",
        source: "Microsoft lifecycle policy",
      },
      {
        id: "s-1002", ref: "scheduledActionsForRule · gracePeriodHours",
        category: "Actions",
        name: "Action for noncompliance — grace period",
        current: "3 days",
        recommended: "1 day",
        severity: "medium",
        why: "A three-day grace period means a device failing BitLocker checks keeps Conditional Access for a full working week.",
        source: "Zero Trust deployment guidance",
      },
      { id: "s-1003", ref: "deviceCompliancePolicy · bitLockerEnabled", category: "Device health", name: "Require BitLocker", current: "Required", recommended: null },
      { id: "s-1004", ref: "deviceCompliancePolicy · signatureOutOfDate", category: "Device health", name: "Defender signatures up to date", current: "Required", recommended: null },
    ],
  },
  {
    id: "cmp-2",
    kind: "compliance",
    name: "Tenant default — devices with no policy",
    platform: "All platforms",
    profile: "Compliance setting",
    groups: ["Tenant-wide"],
    devices: 2350,
    ok: 2350,
    updated: "14 Jan 2026",
    settings: [
      {
        id: "s-1101", ref: "deviceManagement/settings · secureByDefault",
        category: "Tenant defaults",
        name: "Mark devices with no compliance policy assigned as",
        current: "Compliant",
        recommended: "Not compliant",
        severity: "critical",
        why: "Any device that slips out of a group is treated as trusted by Conditional Access. 34 devices currently have no compliance policy at all.",
        source: "Microsoft Zero Trust baseline",
      },
    ],
  },
  {
    id: "cmp-3",
    kind: "compliance",
    name: "iOS/iPadOS — Corporate Compliance",
    platform: "iOS/iPadOS",
    profile: "Compliance policy",
    groups: ["All Corporate iPhones"],
    devices: 508,
    ok: 501,
    updated: "6 Aug 2026",
    settings: [
      {
        id: "s-1201", ref: "deviceCompliancePolicy · osMinimumVersion",
        category: "Device health",
        name: "Minimum OS version",
        current: "17.0",
        recommended: "18.5",
        severity: "medium",
        why: "97% of the fleet is already on 18.5 or later, so raising the floor affects 14 devices.",
        source: "Fleet inventory and Apple lifecycle",
      },
      { id: "s-1202", ref: "deviceCompliancePolicy · jailbroken", category: "Device health", name: "Jailbroken devices", current: "Block", recommended: null },
    ],
  },
  {
    id: "cmp-4",
    kind: "compliance",
    name: "macOS — Corporate Compliance",
    platform: "macOS",
    profile: "Compliance policy",
    groups: ["All Corporate Macs"],
    devices: 342,
    ok: 331,
    updated: "18 Jul 2026",
    settings: [
      { id: "s-1301", ref: "deviceCompliancePolicy · storageRequireEncryption", category: "Device health", name: "Require FileVault", current: "Required", recommended: null },
      { id: "s-1302", ref: "deviceCompliancePolicy · osMinimumVersion", category: "Device health", name: "Minimum OS version", current: "14.0", recommended: null },
    ],
  },
  {
    id: "cmp-5",
    kind: "compliance",
    name: "Android — BYOD Compliance",
    platform: "Android",
    profile: "Compliance policy",
    groups: [],
    devices: 0,
    ok: 0,
    updated: "9 Jun 2026",
    settings: [
      {
        id: "s-1401", ref: "deviceCompliancePolicy · assignments",
        category: "Assignment",
        name: "Groups targeted",
        current: "None",
        recommended: "BYOD Android",
        severity: "critical",
        why: "216 enrolled Android devices have no compliance policy, and the tenant default marks them compliant. They pass Conditional Access unchecked.",
        source: "Coverage gap",
        action: "Assign",
      },
      { id: "s-1402", ref: "deviceCompliancePolicy · securityRequireGooglePlayServices", category: "Device health", name: "Require Play Protect", current: "Required", recommended: null },
    ],
  },

  /* ------------------------------------------------------- enrollment --- */
  {
    id: "enr-1",
    kind: "enrollment",
    name: "Apple — Automated Device Enrollment token",
    platform: "iOS/iPadOS",
    profile: "ADE token",
    groups: ["Apple Business Manager"],
    devices: 508,
    ok: 508,
    updated: "11 Sep 2025",
    settings: [
      {
        id: "s-1501", ref: "depOnboardingSetting · tokenExpirationDateTime",
        category: "Certificates and tokens",
        name: "Token expiry",
        current: "24 days remaining",
        recommended: "Renew now",
        severity: "critical",
        why: "When this token lapses, every new Apple device fails to enrol and existing ADE devices stop syncing. Renewal takes ten minutes and needs an Apple Business Manager admin.",
        source: "Expiry monitor",
        action: "Mark renewed",
      },
      { id: "s-1502", ref: "depOnboardingSetting · lastSuccessfulSyncDateTime", category: "Certificates and tokens", name: "Devices synced", current: "508 of 512", recommended: null },
    ],
  },
  {
    id: "enr-2",
    kind: "enrollment",
    name: "Apple — Push Notification certificate",
    platform: "iOS/iPadOS",
    profile: "MDM push certificate",
    groups: ["Tenant-wide"],
    devices: 850,
    ok: 850,
    updated: "3 Dec 2025",
    settings: [
      { id: "s-1601", ref: "applePushNotificationCertificate · expirationDateTime", category: "Certificates and tokens", name: "Expiry", current: "112 days remaining", recommended: null },
      { id: "s-1602", ref: "applePushNotificationCertificate · appleIdentifier", category: "Certificates and tokens", name: "Apple ID on record", current: "mdm-apple@contoso.com", recommended: null },
    ],
  },
  {
    id: "enr-3",
    kind: "enrollment",
    name: "Windows Autopilot — User-driven, Entra join",
    platform: "Windows",
    profile: "Deployment profile",
    groups: ["Autopilot Devices"],
    devices: 1284,
    ok: 1276,
    updated: "27 Jul 2026",
    settings: [
      {
        id: "s-1701", ref: "windows10EnrollmentCompletionPageConfiguration · blockDeviceSetupRetryByUser",
        category: "Out-of-box experience",
        name: "Enrollment Status Page — block use until apps install",
        current: "Not configured",
        recommended: "Enabled",
        severity: "medium",
        why: "Eight devices reached the desktop before security tooling finished installing. The status page closes that window at first boot.",
        source: "Autopilot deployment guidance",
      },
      { id: "s-1702", ref: "windowsAutopilotDeploymentProfile · deviceType", category: "Out-of-box experience", name: "Deployment mode", current: "User-driven", recommended: null },
      { id: "s-1703", ref: "outOfBoxExperienceSettings · privacySettingsHidden", category: "Out-of-box experience", name: "Skip privacy settings", current: "Yes", recommended: null },
    ],
  },
  {
    id: "enr-4",
    kind: "enrollment",
    name: "Enrollment restrictions — Device limit",
    platform: "All platforms",
    profile: "Device limit restriction",
    groups: ["All Users"],
    devices: 2350,
    ok: 2350,
    updated: "14 Jan 2026",
    settings: [
      {
        id: "s-1801", ref: "deviceEnrollmentLimitConfiguration · limit",
        category: "Restrictions",
        name: "Devices per user",
        current: "15",
        recommended: "5",
        severity: "low",
        why: "The 95th percentile user has three devices. A lower ceiling limits how far a compromised account can go.",
        source: "Fleet inventory",
      },
    ],
  },
  {
    id: "enr-5",
    kind: "enrollment",
    name: "Enrollment restrictions — Platform",
    platform: "All platforms",
    profile: "Device type restriction",
    groups: ["All Users"],
    devices: 2350,
    ok: 2350,
    updated: "2 Feb 2026",
    settings: [
      {
        id: "s-1901", ref: "deviceEnrollmentPlatformRestriction · windowsRestriction.personalDeviceEnrollmentBlocked",
        category: "Restrictions",
        name: "Personally owned Windows devices",
        current: "Allowed",
        recommended: "Blocked",
        severity: "high",
        why: "Windows BYOD is allowed but no configuration or compliance policy targets it. Either block enrolment or build the policy set.",
        source: "Coverage gap",
      },
      { id: "s-1902", ref: "deviceEnrollmentPlatformRestriction · iosRestriction.personalDeviceEnrollmentBlocked", category: "Restrictions", name: "Personally owned iOS devices", current: "Allowed", recommended: null },
      { id: "s-1903", ref: "deviceEnrollmentPlatformRestriction · androidForWorkRestriction.personalDeviceEnrollmentBlocked", category: "Restrictions", name: "Personally owned Android devices", current: "Allowed (work profile only)", recommended: null },
    ],
  },
];

/* Notes are keyed by setting key (configuration) or policy id (everything
   else). They persist the reasoning that Intune itself never stores.      */
const CURRENT_USER = "You";
const TODAY = "18 Aug 2026";

const SEED_NOTES = {
  "Tamper protection::Windows": [
    {
      id: "n1",
      author: "M. Chen",
      date: "14 Mar 2026",
      text: "Turned off for the Symantec removal — their uninstaller trips over it. Turn back on once the migration closes.",
    },
    { id: "n2", author: "M. Chen", date: "20 Jul 2026", text: "Migration finished. Nothing is blocking this now." },
  ],
  "Quality update deferral::Windows": [
    {
      id: "n3",
      author: "R. Adeyemi",
      date: "12 Aug 2026",
      text: "The overlap is deliberate for now. Pilot predates the broad ring and we kept both through the hardware refresh. Scope pilot to IT Pilot only once the refresh closes in September.",
    },
  ],
  "BitLocker OS drive encryption method::Windows": [
    {
      id: "n4",
      author: "R. Adeyemi",
      date: "9 Nov 2024",
      text: "Held at 128-bit for the Surface Pro 7 fleet, which took a real boot hit. Those are all retired.",
    },
  ],
  "Require passcode after inactivity::iOS/iPadOS": [
    {
      id: "n5",
      author: "Service desk",
      date: "2 Jun 2026",
      text: "Warehouse scanners re-auth constantly at five minutes and Ops pushed back hard. Check with them before lowering this, or scope the tighter value to office users only.",
    },
  ],
  "cmp-2": [
    {
      id: "n6",
      author: "M. Chen",
      date: "3 Feb 2026",
      text: "Raised at the architecture review. Blocked on the Android BYOD gap — flipping this while 216 devices have no policy would lock them all out on Monday morning. Fix that first.",
    },
  ],
};

const KINDS = {
  configuration: { label: "Configuration", noun: "configuration policies" },
  compliance: { label: "Compliance", noun: "compliance policies" },
  enrollment: { label: "Enrollment", noun: "enrollment settings" },
};

const SEVERITY = {
  critical: { label: "Critical", chip: "bg-red-50 text-red-700 ring-red-200", dot: "bg-red-500", rank: 0 },
  high: { label: "High", chip: "bg-amber-50 text-amber-800 ring-amber-200", dot: "bg-amber-500", rank: 1 },
  medium: { label: "Medium", chip: "bg-stone-100 text-stone-700 ring-stone-300", dot: "bg-stone-500", rank: 2 },
  low: { label: "Low", chip: "bg-stone-50 text-stone-500 ring-stone-200", dot: "bg-stone-300", rank: 3 },
};

/* Only problems get colour. Anything already correct stays quiet. */
const STATE_STYLE = {
  Conflict: "bg-red-50 text-red-700 ring-red-200",
  "Below baseline": "bg-amber-50 text-amber-800 ring-amber-200",
  Staged: "bg-teal-50 text-teal-800 ring-teal-200",
  "Not deployed": "bg-stone-100 text-stone-500 ring-stone-200",
  Dismissed: "bg-stone-100 text-stone-500 ring-stone-200",
  Baseline: "bg-white text-stone-500 ring-stone-200",
};

const STATUS_STYLE = {
  Healthy: "bg-white text-stone-500 ring-stone-200",
  "Minor gaps": "bg-stone-100 text-stone-600 ring-stone-200",
  "Needs review": "bg-amber-50 text-amber-800 ring-amber-200",
  Unassigned: "bg-stone-100 text-stone-600 ring-stone-200",
};

/* ------------------------------------------------------------- helpers --- */

const pct = (a, b) => (b === 0 ? 0 : Math.round((a / b) * 100));

function policyStatus(item, applied) {
  const open = item.settings.filter((s) => s.recommended && !applied[s.id]);
  if (item.groups.length === 0) return "Unassigned";
  if (open.some((s) => s.severity === "critical" || s.severity === "high")) return "Needs review";
  if (open.length > 0) return "Minor gaps";
  return "Healthy";
}

/* Flatten every configuration setting into one tenant-wide index, keyed by
   setting name + platform. One entry can be defined by several policies.  */
function buildSettingIndex(items, applied, dismissed) {
  const map = new Map();

  items
    .filter((i) => i.kind === "configuration")
    .forEach((policy) => {
      policy.settings.forEach((s) => {
        const key = s.name + "::" + policy.platform;
        if (!map.has(key)) {
          map.set(key, {
            key,
            name: s.name,
            category: s.category,
            ref: s.ref,
            platform: policy.platform,
            sources: [],
            rec: null,
          });
        }
        const entry = map.get(key);
        entry.sources.push({ policy, setting: s });
        if (s.recommended && !entry.rec) entry.rec = s;
      });
    });

  return Array.from(map.values())
    .map((e) => {
      const values = Array.from(new Set(e.sources.map((s) => s.setting.current)));
      const deployed = e.sources.filter((s) => s.policy.groups.length > 0);
      const conflict = values.length > 1 && deployed.length > 1;
      const isApplied = e.rec ? Boolean(applied[e.rec.id]) : false;
      const isDismissed = e.rec ? Boolean(dismissed[e.rec.id]) : false;

      let state = "Baseline";
      if (conflict) state = "Conflict";
      else if (deployed.length === 0) state = "Not deployed";
      else if (isApplied) state = "Staged";
      else if (e.rec && isDismissed) state = "Dismissed";
      else if (e.rec) state = "Below baseline";

      return {
        ...e,
        values,
        conflict,
        deployed,
        isApplied,
        isDismissed,
        state,
        value: isApplied ? e.rec.recommended : values.join("  /  "),
        devices: deployed.reduce((n, s) => Math.max(n, s.policy.devices), 0),
      };
    })
    .sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
}

/* ---------------------------------------------------------------- bits --- */

function Chip({ className = "", children }) {
  return (
    <span className={"inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset " + className}>
      {children}
    </span>
  );
}

function Meter({ value, tone = "teal" }) {
  const bar = tone === "teal" ? "bg-teal-500" : tone === "amber" ? "bg-amber-500" : "bg-red-500";
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-stone-200">
      <div className={"h-full rounded-full " + bar} style={{ width: value + "%" }} />
    </div>
  );
}

function Diff({ from, to }) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="rounded border border-stone-200 bg-stone-50 px-2 py-1 text-stone-500 line-through decoration-stone-300">{from}</span>
      <ChevronRight className="h-4 w-4 shrink-0 text-stone-400" />
      <span className="rounded border border-teal-200 bg-teal-50 px-2 py-1 font-medium text-teal-800">{to}</span>
    </div>
  );
}

function refLabel(platform) {
  if (platform === "Windows") return "CSP / OMA-URI";
  if (platform === "macOS" || platform === "iOS/iPadOS") return "Payload key";
  if (platform === "Android") return "Managed configuration key";
  return "Graph property";
}

function RefPath({ value, label }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      const el = document.createElement("textarea");
      el.value = value;
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="rounded-md border border-stone-200 bg-stone-50 p-3">
      {label ? <div className="text-xs font-medium uppercase tracking-wide text-stone-500">{label}</div> : null}
      <div className="mt-1.5 flex items-start gap-2">
        <code className="min-w-0 flex-1 break-all font-mono text-xs leading-relaxed text-stone-700">{value}</code>
        <button
          onClick={copy}
          className="shrink-0 rounded px-1.5 py-1 text-stone-400 hover:bg-white hover:text-stone-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
          aria-label="Copy path"
          title="Copy path"
        >
          {copied ? <Check className="h-3.5 w-3.5 text-teal-600" /> : <Copy className="h-3.5 w-3.5" />}
        </button>
      </div>
    </div>
  );
}

function NoteThread({ notes = [], onAdd }) {
  const [draft, setDraft] = useState("");

  function submit() {
    const text = draft.trim();
    if (!text) return;
    onAdd(text);
    setDraft("");
  }

  return (
    <section>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-stone-500">
        Notes {notes.length ? <span className="tabular-nums text-stone-400">· {notes.length}</span> : null}
      </h3>

      {notes.length > 0 && (
        <ul className="mt-2 space-y-2">
          {notes.map((n) => (
            <li key={n.id} className="rounded-md border border-stone-200 bg-stone-50 p-3">
              <div className="flex items-baseline justify-between gap-2 text-xs">
                <span className="font-medium text-stone-700">{n.author}</span>
                <span className="shrink-0 text-stone-400">{n.date}</span>
              </div>
              <p className="mt-1.5 text-xs leading-relaxed text-stone-600">{n.text}</p>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-2">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={2}
          placeholder={notes.length ? "Add to the thread" : "Why is it set this way? Write it down for whoever looks next."}
          className="w-full resize-none rounded-md border border-stone-300 bg-white p-2.5 text-xs placeholder-stone-400 focus:border-teal-600 focus:outline-none focus:ring-1 focus:ring-teal-600"
        />
        <button
          onClick={submit}
          disabled={!draft.trim()}
          className="mt-1.5 rounded-md px-2.5 py-1 text-xs font-medium text-stone-600 ring-1 ring-inset ring-stone-300 hover:bg-stone-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 disabled:cursor-not-allowed disabled:text-stone-300 disabled:ring-stone-200"
        >
          Add note
        </button>
      </div>
    </section>
  );
}

function Stat({ label, value, sub, tone = "neutral", icon: Icon }) {
  const iconTone =
    tone === "amber" ? "text-amber-500" : tone === "alert" ? "text-red-500" : tone === "brand" ? "text-teal-600" : "text-stone-400";
  return (
    <div className="rounded-lg border border-stone-200 bg-white p-4">
      <div className="flex items-center gap-1.5">
        {Icon ? <Icon className={"h-3.5 w-3.5 shrink-0 " + iconTone} /> : null}
        <div className="text-xs font-medium uppercase tracking-wide text-stone-500">{label}</div>
      </div>
      <div className="mt-2 text-3xl font-semibold tabular-nums text-stone-900">{value}</div>
      {sub ? <div className="mt-1 text-xs text-stone-500">{sub}</div> : null}
    </div>
  );
}

/* ----------------------------------------------------------------- app --- */

export default function App() {
  const [view, setView] = useState("overview");
  const [query, setQuery] = useState("");
  const [platform, setPlatform] = useState("All");
  const [applied, setApplied] = useState({});
  const [dismissed, setDismissed] = useState({});
  const [changes, setChanges] = useState([]);
  const [notes, setNotes] = useState(SEED_NOTES);
  const [open, setOpen] = useState(null);
  const [toast, setToast] = useState(null);

  const items = SEED;
  const settingIndex = useMemo(() => buildSettingIndex(items, applied, dismissed), [items, applied, dismissed]);

  const flash = (msg) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 2600);
  };

  const recs = useMemo(() => {
    const list = [];
    items.forEach((item) => {
      item.settings.forEach((s) => {
        if (!s.recommended || applied[s.id] || dismissed[s.id]) return;
        list.push({ ...s, item });
      });
    });
    return list.sort((a, b) => SEVERITY[a.severity].rank - SEVERITY[b.severity].rank);
  }, [items, applied, dismissed]);

  const totals = useMemo(() => {
    const covered = items.filter((i) => i.kind === "compliance" && i.groups.length > 0);
    const ok = covered.reduce((n, i) => n + i.ok, 0);
    const all = covered.reduce((n, i) => n + i.devices, 0);
    return {
      devices: 2350,
      settings: settingIndex.length,
      compliance: pct(ok, all),
      critical: recs.filter((r) => r.severity === "critical").length,
    };
  }, [items, recs, settingIndex]);

  const staged = changes.filter((c) => c.status === "staged");

  /* open the right detail panel for a recommendation */
  function openFor(rec) {
    if (rec.item.kind === "configuration") {
      const entry = settingIndex.find((e) => e.name === rec.name && e.platform === rec.item.platform);
      if (entry) return setOpen({ type: "setting", key: entry.key });
    }
    setOpen({ type: "policy", id: rec.item.id });
  }

  function addNote(key, text) {
    setNotes((n) => ({
      ...n,
      [key]: [...(n[key] || []), { id: key + "-" + Date.now(), author: CURRENT_USER, date: TODAY, text }],
    }));
    flash("Note added");
  }

  function apply(setting, item) {
    setApplied((a) => ({ ...a, [setting.id]: true }));
    setChanges((c) => [
      {
        id: setting.id,
        policy: item.name,
        setting: setting.name,
        from: setting.current,
        to: setting.recommended,
        status: "staged",
        reason: "",
        reviewedBy: null,
      },
      ...c.filter((x) => x.id !== setting.id),
    ]);
    flash("Change staged. Add a reason before you deploy");
  }

  function setReason(id, reason) {
    setChanges((c) => c.map((x) => (x.id === id ? { ...x, reason } : x)));
  }

  function toggleReview(id) {
    setChanges((c) => c.map((x) => (x.id === id ? { ...x, reviewedBy: x.reviewedBy ? null : CURRENT_USER } : x)));
  }

  function revert(id) {
    setApplied((a) => {
      const next = { ...a };
      delete next[id];
      return next;
    });
    setChanges((c) => c.filter((x) => x.id !== id));
    flash("Change reverted");
  }

  function dismiss(id) {
    setDismissed((d) => ({ ...d, [id]: true }));
    flash("Recommendation dismissed");
  }

  function deploy() {
    const ready = staged.filter((c) => c.reason.trim() && c.reviewedBy);
    if (ready.length === 0 || ready.length !== staged.length) return;
    const n = ready.length;
    setChanges((c) => c.map((x) => (x.status === "staged" ? { ...x, status: "deployed", deployedOn: TODAY } : x)));
    flash(n + (n === 1 ? " change deployed to the tenant" : " changes deployed to the tenant"));
  }

  const nav = [
    { id: "overview", label: "Overview", icon: LayoutDashboard },
    { id: "configuration", label: "Settings", icon: Sliders, count: settingIndex.length },
    { id: "compliance", label: "Compliance", icon: ShieldCheck, count: items.filter((i) => i.kind === "compliance").length },
    { id: "enrollment", label: "Enrollment", icon: Smartphone, count: items.filter((i) => i.kind === "enrollment").length },
    { id: "recommendations", label: "Recommendations", icon: Lightbulb, count: recs.length },
    { id: "changes", label: "Change log", icon: ListChecks, count: staged.length },
  ];

  const openSetting = open?.type === "setting" ? settingIndex.find((e) => e.key === open.key) : null;
  const openPolicy = open?.type === "policy" ? items.find((i) => i.id === open.id) : null;

  return (
    <div className="flex min-h-screen w-full flex-col bg-stone-50 text-stone-900 lg:flex-row">
      <aside className="shrink-0 bg-teal-900 lg:w-60">
        <div className="flex items-center gap-2.5 px-4 py-4">
          <Compass className="h-6 w-6 shrink-0 text-teal-300" />
          <div>
            <div className="text-sm font-semibold leading-tight text-white">IntuneAtlas</div>
            <div className="text-xs leading-tight text-teal-300">contoso.onmicrosoft.com</div>
          </div>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-2 pb-3 lg:flex-col lg:overflow-visible lg:pb-4">
          {nav.map((n) => {
            const Icon = n.icon;
            const active = view === n.id;
            return (
              <button
                key={n.id}
                onClick={() => setView(n.id)}
                className={
                  "flex shrink-0 items-center gap-2 rounded-md px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-300 lg:w-full " +
                  (active ? "bg-teal-800 font-medium text-white" : "text-teal-100 hover:bg-teal-800")
                }
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className="whitespace-nowrap">{n.label}</span>
                {n.count ? (
                  <span
                    className={
                      "ml-auto rounded px-1.5 py-0.5 text-xs tabular-nums " +
                      (active ? "bg-teal-700 text-teal-50" : "bg-teal-800 text-teal-200")
                    }
                  >
                    {n.count}
                  </span>
                ) : null}
              </button>
            );
          })}
        </nav>
      </aside>

      <main className="min-w-0 flex-1">
        <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:py-8">
          {view === "overview" && (
            <Overview items={items} recs={recs} totals={totals} settingIndex={settingIndex} changes={changes} onOpen={openFor} onGo={setView} />
          )}

          {view === "configuration" && (
            <SettingsView
              entries={settingIndex}
              notes={notes}
              query={query}
              setQuery={setQuery}
              platform={platform}
              setPlatform={setPlatform}
              onOpen={(key) => setOpen({ type: "setting", key })}
            />
          )}

          {["compliance", "enrollment"].includes(view) && (
            <PolicyList
              kind={view}
              items={items.filter((i) => i.kind === view)}
              applied={applied}
              query={query}
              setQuery={setQuery}
              onOpen={(id) => setOpen({ type: "policy", id })}
            />
          )}

          {view === "recommendations" && <Recommendations recs={recs} onApply={apply} onDismiss={dismiss} onOpen={openFor} />}

          {view === "changes" && (
            <ChangeLog
              changes={changes}
              staged={staged}
              onRevert={revert}
              onDeploy={deploy}
              onReason={setReason}
              onToggleReview={toggleReview}
            />
          )}
        </div>
      </main>

      {openSetting && (
        <SettingDrawer
          entry={openSetting}
          notes={notes[openSetting.key] || []}
          onAddNote={(text) => addNote(openSetting.key, text)}
          onClose={() => setOpen(null)}
          onApply={apply}
          onDismiss={dismiss}
          onRevert={revert}
        />
      )}
      {openPolicy && (
        <PolicyDrawer
          item={openPolicy}
          applied={applied}
          dismissed={dismissed}
          notes={notes[openPolicy.id] || []}
          onAddNote={(text) => addNote(openPolicy.id, text)}
          onClose={() => setOpen(null)}
          onApply={apply}
          onDismiss={dismiss}
          onRevert={revert}
        />
      )}

      {toast && (
        <div className="pointer-events-none fixed bottom-4 left-1/2 z-50 -translate-x-1/2">
          <div className="rounded-md bg-stone-900 px-4 py-2 text-sm text-white shadow-lg">{toast}</div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------ overview --- */

function Overview({ items, recs, totals, settingIndex, changes, onOpen, onGo }) {
  const conflicts = settingIndex.filter((e) => e.conflict).length;
  const undeployed = settingIndex.filter((e) => e.state === "Not deployed").length;

  const byPlatform = ["Windows", "macOS", "iOS/iPadOS", "Android"].map((p) => {
    const set = items.filter((i) => i.kind === "compliance" && i.platform === p && i.groups.length > 0);
    const ok = set.reduce((n, i) => n + i.ok, 0);
    const all = set.reduce((n, i) => n + i.devices, 0);
    const gap = items.some((i) => i.kind === "compliance" && i.platform === p && i.groups.length === 0);
    return { platform: p, value: pct(ok, all), all, gap };
  });

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold">Overview</h1>
        <p className="mt-1 text-sm text-stone-500">Where the tenant stands, and what to fix first.</p>
      </header>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Devices" value={totals.devices.toLocaleString()} sub="Enrolled and checking in" icon={Smartphone} />
        <Stat
          label="Settings managed"
          value={totals.settings}
          sub={conflicts + " conflicting, " + undeployed + " not deployed"}
          tone={conflicts ? "amber" : "neutral"}
          icon={Sliders}
        />
        <Stat label="Compliant" value={totals.compliance + "%"} sub="Of devices with a policy assigned" tone="brand" icon={ShieldCheck} />
        <Stat
          label="Open recommendations"
          value={recs.length}
          sub={totals.critical + " critical"}
          tone={totals.critical ? "alert" : "neutral"}
          icon={Lightbulb}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        <section className="rounded-lg border border-stone-200 bg-white lg:col-span-3">
          <div className="flex items-center justify-between border-b border-stone-200 px-4 py-3">
            <h2 className="text-sm font-semibold">Fix these first</h2>
            <button
              onClick={() => onGo("recommendations")}
              className="rounded text-xs font-medium text-teal-600 hover:text-teal-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
            >
              See all {recs.length}
            </button>
          </div>
          <ul className="divide-y divide-stone-100">
            {recs.slice(0, 5).map((r) => (
              <li key={r.id}>
                <button
                  onClick={() => onOpen(r)}
                  className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-stone-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-teal-500"
                >
                  <span className={"mt-1.5 h-2 w-2 shrink-0 rounded-full " + SEVERITY[r.severity].dot} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">{r.name}</span>
                    <span className="mt-0.5 block truncate text-xs text-stone-500">
                      {r.item.platform} · {r.category}
                    </span>
                  </span>
                  <Chip className={SEVERITY[r.severity].chip}>{SEVERITY[r.severity].label}</Chip>
                </button>
              </li>
            ))}
            {recs.length === 0 && (
              <li className="px-4 py-10 text-center">
                <CheckCircle2 className="mx-auto h-6 w-6 text-teal-500" />
                <p className="mt-2 text-sm font-medium">Nothing outstanding</p>
                <p className="mt-1 text-xs text-stone-500">Every recommendation has been applied or dismissed.</p>
              </li>
            )}
          </ul>
        </section>

        <section className="space-y-4 lg:col-span-2">
          <div className="rounded-lg border border-stone-200 bg-white p-4">
            <h2 className="text-sm font-semibold">Compliance by platform</h2>
            <ul className="mt-3 space-y-3">
              {byPlatform.map((p) => (
                <li key={p.platform}>
                  <div className="flex items-baseline justify-between text-xs">
                    <span className="font-medium text-stone-700">{p.platform}</span>
                    <span className="tabular-nums text-stone-500">{p.gap ? "No policy assigned" : p.value + "% of " + p.all.toLocaleString()}</span>
                  </div>
                  <div className="mt-1.5">
                    <Meter value={p.gap ? 100 : p.value} tone={p.gap ? "alert" : p.value >= 95 ? "teal" : "amber"} />
                  </div>
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-lg border border-stone-200 bg-white p-4">
            <h2 className="text-sm font-semibold">Recent changes</h2>
            {changes.length === 0 ? (
              <p className="mt-2 text-xs text-stone-500">
                No changes yet. Applying a recommendation stages it here before anything reaches the tenant.
              </p>
            ) : (
              <ul className="mt-3 space-y-2">
                {changes.slice(0, 4).map((c) => (
                  <li key={c.id} className="flex items-center gap-2 text-xs">
                    {c.status === "staged" ? (
                      <Clock className="h-3.5 w-3.5 shrink-0 text-amber-500" />
                    ) : (
                      <Check className="h-3.5 w-3.5 shrink-0 text-teal-600" />
                    )}
                    <span className="truncate text-stone-700">{c.setting}</span>
                    <span className="ml-auto shrink-0 text-stone-400">
                      {c.status === "deployed" ? "deployed" : c.reason.trim() && c.reviewedBy ? "ready" : "needs review"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

/* ------------------------------------------------- settings (config) ----- */

function SettingsView({ entries, notes = {}, query, setQuery, platform, setPlatform, onOpen }) {
  const [state, setState] = useState("All");
  const platforms = ["All", ...Array.from(new Set(entries.map((e) => e.platform)))];
  const states = ["All", "Below baseline", "Conflict", "Not deployed", "Baseline"];

  const shown = entries.filter(
    (e) =>
      (platform === "All" || e.platform === platform) &&
      (state === "All" || e.state === state) &&
      (e.name.toLowerCase().includes(query.toLowerCase()) ||
        e.category.toLowerCase().includes(query.toLowerCase()) ||
        (e.ref || "").toLowerCase().includes(query.toLowerCase()))
  );

  const categories = Array.from(new Set(shown.map((e) => e.category)));

  const count = (s) => entries.filter((e) => e.state === s).length;

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-xl font-semibold">Settings</h1>
        <p className="mt-1 text-sm text-stone-500">
          Every configuration setting in the tenant, merged across policies. Where two policies set the same thing differently, it
          shows up here as a conflict.
        </p>
      </header>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Managed" value={entries.length} icon={Sliders} />
        <Stat label="Below baseline" value={count("Below baseline")} tone={count("Below baseline") ? "amber" : "neutral"} icon={AlertCircle} />
        <Stat label="Conflicting" value={count("Conflict")} tone={count("Conflict") ? "alert" : "neutral"} icon={AlertTriangle} />
        <Stat label="Not deployed" value={count("Not deployed")} icon={Ban} />
      </div>

      <div className="flex flex-col gap-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-stone-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name, category, or CSP path"
            className="w-full rounded-md border border-stone-300 bg-white py-2 pl-9 pr-3 text-sm placeholder-stone-400 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
          />
        </div>
        <div className="flex flex-wrap gap-1">
          {states.map((s) => (
            <button
              key={s}
              onClick={() => setState(s)}
              className={
                "shrink-0 rounded-md px-3 py-1.5 text-xs font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 " +
                (state === s ? "bg-stone-900 text-white" : "bg-white text-stone-600 ring-1 ring-inset ring-stone-300 hover:bg-stone-50")
              }
            >
              {s}
              <span className="ml-1.5 tabular-nums opacity-60">{s === "All" ? entries.length : count(s)}</span>
            </button>
          ))}
          <span className="mx-1 hidden w-px bg-stone-200 sm:block" />
          {platforms.map((p) => (
            <button
              key={p}
              onClick={() => setPlatform(p)}
              className={
                "shrink-0 rounded-md px-3 py-1.5 text-xs font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 " +
                (platform === p ? "bg-teal-700 text-white" : "bg-white text-stone-600 ring-1 ring-inset ring-stone-300 hover:bg-stone-50")
              }
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-5">
        {categories.map((cat) => (
          <section key={cat}>
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-500">{cat}</h2>
            <ul className="divide-y divide-stone-100 overflow-hidden rounded-lg border border-stone-200 bg-white">
              {shown
                .filter((e) => e.category === cat)
                .map((e) => (
                  <li key={e.key}>
                    <button
                      onClick={() => onOpen(e.key)}
                      className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-stone-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-teal-500"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate text-sm font-medium">{e.name}</span>
                          {(notes[e.key] || []).length > 0 && (
                            <span
                              className="inline-flex shrink-0 items-center gap-0.5 text-xs text-stone-400"
                              title={(notes[e.key] || []).length + " notes"}
                            >
                              <MessageSquare className="h-3.5 w-3.5" />
                              <span className="tabular-nums">{(notes[e.key] || []).length}</span>
                            </span>
                          )}
                        </div>
                        <div className="mt-0.5 truncate text-xs text-stone-500">
                          {e.platform} · {e.sources.length === 1 ? e.sources[0].policy.name : e.sources.length + " policies"}
                          {e.devices ? " · " + e.devices.toLocaleString() + " devices" : ""}
                        </div>
                      </div>
                      <div className="hidden w-56 shrink-0 sm:block">
                        <div className={"truncate text-sm " + (e.conflict ? "text-red-700" : "text-stone-700")}>{e.value}</div>
                        {e.state === "Below baseline" && (
                          <div className="mt-0.5 truncate text-xs text-teal-700">→ {e.rec.recommended}</div>
                        )}
                      </div>
                      <Chip className={STATE_STYLE[e.state]}>{e.state}</Chip>
                    </button>
                  </li>
                ))}
            </ul>
          </section>
        ))}

        {shown.length === 0 && (
          <div className="rounded-lg border border-dashed border-stone-300 bg-white px-4 py-16 text-center">
            <p className="text-sm font-medium">No settings match that filter</p>
            <p className="mt-1 text-xs text-stone-500">Clear the search or pick a different state.</p>
          </div>
        )}
      </div>
    </div>
  );
}

/* --------------------------------------------------------- policy list --- */

function PolicyList({ kind, items, applied, query, setQuery, onOpen }) {
  const shown = items.filter((i) => i.name.toLowerCase().includes(query.toLowerCase()) || i.profile.toLowerCase().includes(query.toLowerCase()));

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-xl font-semibold">{KINDS[kind].label}</h1>
        <p className="mt-1 text-sm text-stone-500">
          {items.length} {KINDS[kind].noun}. Select one to see every setting and how it compares to the baseline.
        </p>
      </header>

      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-stone-400" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name or profile type"
          className="w-full rounded-md border border-stone-300 bg-white py-2 pl-9 pr-3 text-sm placeholder-stone-400 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
        />
      </div>

      <div className="overflow-hidden rounded-lg border border-stone-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-stone-200 bg-stone-50 text-xs uppercase tracking-wide text-stone-500">
            <tr>
              <th className="px-4 py-2.5 font-medium">Policy</th>
              <th className="hidden px-4 py-2.5 font-medium md:table-cell">Assigned to</th>
              <th className="hidden px-4 py-2.5 font-medium sm:table-cell">Devices</th>
              <th className="px-4 py-2.5 font-medium">Status</th>
              <th className="px-4 py-2.5 text-right font-medium">Gaps</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {shown.map((i) => {
              const status = policyStatus(i, applied);
              const gaps = i.settings.filter((s) => s.recommended && !applied[s.id]).length;
              return (
                <tr
                  key={i.id}
                  onClick={() => onOpen(i.id)}
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") onOpen(i.id);
                  }}
                  className="cursor-pointer hover:bg-stone-50 focus:bg-stone-50 focus:outline-none"
                >
                  <td className="px-4 py-3">
                    <div className="font-medium">{i.name}</div>
                    <div className="mt-0.5 text-xs text-stone-500">
                      {i.platform} · {i.profile}
                    </div>
                  </td>
                  <td className="hidden px-4 py-3 text-xs text-stone-600 md:table-cell">
                    {i.groups.length ? (
                      <span className="inline-flex items-center gap-1.5">
                        <Users className="h-3.5 w-3.5 text-stone-400" />
                        {i.groups.join(", ")}
                      </span>
                    ) : (
                      <span className="text-stone-400">—</span>
                    )}
                  </td>
                  <td className="hidden px-4 py-3 sm:table-cell">
                    {i.devices ? (
                      <div className="w-24">
                        <div className="text-xs tabular-nums text-stone-600">{i.devices.toLocaleString()}</div>
                        <div className="mt-1">
                          <Meter value={pct(i.ok, i.devices)} tone={pct(i.ok, i.devices) >= 95 ? "teal" : "amber"} />
                        </div>
                      </div>
                    ) : (
                      <span className="text-xs text-stone-400">None</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <Chip className={STATUS_STYLE[status]}>{status}</Chip>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-stone-600">{gaps || "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {shown.length === 0 && (
          <div className="px-4 py-12 text-center">
            <p className="text-sm font-medium">No policies match that search</p>
            <p className="mt-1 text-xs text-stone-500">Try a shorter term.</p>
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------------------------------------------------- recommendations --- */

function Recommendations({ recs, onApply, onDismiss, onOpen }) {
  const [filter, setFilter] = useState("All");
  const levels = ["All", "critical", "high", "medium", "low"];
  const shown = recs.filter((r) => filter === "All" || r.severity === filter);

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-xl font-semibold">Recommendations</h1>
        <p className="mt-1 text-sm text-stone-500">
          Settings that differ from the baseline, ranked by what they expose. Applying stages the change — nothing reaches the tenant
          until you deploy.
        </p>
      </header>

      <div className="flex gap-1 overflow-x-auto">
        {levels.map((l) => (
          <button
            key={l}
            onClick={() => setFilter(l)}
            className={
              "shrink-0 rounded-md px-3 py-1.5 text-xs font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 " +
              (filter === l ? "bg-stone-900 text-white" : "bg-white text-stone-600 ring-1 ring-inset ring-stone-300 hover:bg-stone-50")
            }
          >
            {l === "All" ? "All" : SEVERITY[l].label}
            <span className="ml-1.5 tabular-nums opacity-60">{l === "All" ? recs.length : recs.filter((r) => r.severity === l).length}</span>
          </button>
        ))}
      </div>

      <div className="space-y-3">
        {shown.map((r) => (
          <article key={r.id} className="rounded-lg border border-stone-200 bg-white p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <Chip className={SEVERITY[r.severity].chip}>{SEVERITY[r.severity].label}</Chip>
                  <span className="truncate text-xs text-stone-500">
                    {r.item.platform} · {r.category}
                  </span>
                </div>
                <h3 className="mt-2 font-medium">{r.name}</h3>
                <button
                  onClick={() => onOpen(r)}
                  className="mt-0.5 rounded text-xs text-stone-500 hover:text-teal-600 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
                >
                  {r.item.kind === "configuration" ? "See where this is set" : "Open " + r.item.name}
                </button>
              </div>
              <div className="flex shrink-0 gap-2">
                <button
                  onClick={() => onDismiss(r.id)}
                  className="rounded-md px-3 py-1.5 text-xs font-medium text-stone-600 ring-1 ring-inset ring-stone-300 hover:bg-stone-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
                >
                  Dismiss
                </button>
                <button
                  onClick={() => onApply(r, r.item)}
                  className="rounded-md bg-teal-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-teal-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
                >
                  {r.action || "Apply"}
                </button>
              </div>
            </div>

            <div className="mt-3">
              <Diff from={r.current} to={r.recommended} />
            </div>

            <p className="mt-3 text-sm leading-relaxed text-stone-600">{r.why}</p>
            <p className="mt-2 text-xs text-stone-400">Source: {r.source}</p>
          </article>
        ))}

        {shown.length === 0 && (
          <div className="rounded-lg border border-dashed border-stone-300 bg-white px-4 py-16 text-center">
            <CheckCircle2 className="mx-auto h-7 w-7 text-teal-500" />
            <p className="mt-3 text-sm font-medium">No recommendations at this level</p>
            <p className="mt-1 text-xs text-stone-500">Switch filters to review the rest, or check the change log.</p>
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------- change log --- */

function ChangeLog({ changes, staged, onRevert, onDeploy, onReason, onToggleReview }) {
  const ready = staged.filter((c) => c.reason.trim() && c.reviewedBy).length;
  const blocked = staged.length - ready;
  const canDeploy = staged.length > 0 && blocked === 0;

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Change log</h1>
          <p className="mt-1 text-sm text-stone-500">
            {staged.length === 0
              ? "Everything applied has been deployed."
              : blocked === 0
              ? staged.length + " staged and ready."
              : ready + " of " + staged.length + " ready. The rest need a reason or a review."}
          </p>
        </div>
        <button
          onClick={onDeploy}
          disabled={!canDeploy}
          className="inline-flex items-center gap-2 rounded-md bg-teal-800 px-3.5 py-2 text-sm font-medium text-white hover:bg-teal-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 disabled:cursor-not-allowed disabled:bg-stone-200 disabled:text-stone-400"
        >
          <Send className="h-4 w-4" />
          Deploy {staged.length > 0 ? staged.length + " changes" : "changes"}
        </button>
      </header>

      {changes.length === 0 ? (
        <div className="rounded-lg border border-dashed border-stone-300 bg-white px-4 py-16 text-center">
          <p className="text-sm font-medium">Nothing staged yet</p>
          <p className="mx-auto mt-1 max-w-sm text-xs text-stone-500">
            Apply a recommendation and it lands here first. Every change needs a reason and a second pair of eyes before it reaches
            devices.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {changes.map((c) => {
            const isStaged = c.status === "staged";
            return (
              <li key={c.id} className="rounded-lg border border-stone-200 bg-white p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Chip
                        className={
                          isStaged ? "bg-amber-50 text-amber-800 ring-amber-200" : "bg-white text-stone-500 ring-stone-200"
                        }
                      >
                        {isStaged ? "Staged" : "Deployed " + c.deployedOn}
                      </Chip>
                      <span className="truncate text-xs text-stone-500">{c.policy}</span>
                    </div>
                    <h3 className="mt-2 text-sm font-medium">{c.setting}</h3>
                  </div>
                  {isStaged && (
                    <button
                      onClick={() => onRevert(c.id)}
                      className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium text-stone-600 ring-1 ring-inset ring-stone-300 hover:bg-stone-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      Revert
                    </button>
                  )}
                </div>

                <div className="mt-3">
                  <Diff from={c.from} to={c.to} />
                </div>

                {isStaged ? (
                  <div className="mt-3 space-y-3 border-t border-stone-100 pt-3">
                    <div>
                      <label className="text-xs font-medium text-stone-600">Reason for the change</label>
                      <textarea
                        value={c.reason}
                        onChange={(e) => onReason(c.id, e.target.value)}
                        rows={2}
                        placeholder="What prompted this, and what did you check before staging it?"
                        className="mt-1 w-full resize-none rounded-md border border-stone-300 bg-white p-2.5 text-xs placeholder-stone-400 focus:border-teal-600 focus:outline-none focus:ring-1 focus:ring-teal-600"
                      />
                    </div>

                    <div className="flex flex-wrap items-center gap-3">
                      <button
                        onClick={() => onToggleReview(c.id)}
                        className={
                          "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 " +
                          (c.reviewedBy
                            ? "bg-teal-50 text-teal-800 ring-1 ring-inset ring-teal-200"
                            : "text-stone-600 ring-1 ring-inset ring-stone-300 hover:bg-stone-50")
                        }
                      >
                        <UserCheck className="h-3.5 w-3.5" />
                        {c.reviewedBy ? "Reviewed by " + c.reviewedBy : "Mark reviewed"}
                      </button>

                      {!c.reason.trim() && <span className="text-xs text-amber-700">Needs a reason</span>}
                      {c.reason.trim() && !c.reviewedBy && <span className="text-xs text-amber-700">Needs a review</span>}
                      {c.reason.trim() && c.reviewedBy && <span className="text-xs text-stone-400">Ready to deploy</span>}
                    </div>
                  </div>
                ) : (
                  <div className="mt-3 border-t border-stone-100 pt-3">
                    <p className="text-xs leading-relaxed text-stone-600">{c.reason}</p>
                    <p className="mt-1.5 text-xs text-stone-400">Reviewed by {c.reviewedBy}</p>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/* ------------------------------------------------------ setting drawer --- */

function DrawerShell({ eyebrow, title, chips, onClose, children }) {
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-40 flex justify-end" role="dialog" aria-modal="true" aria-label={title}>
      {/* inline rgba, not bg-opacity — that utility is gone in Tailwind v4 */}
      <div
        className="absolute inset-0 transition-opacity"
        style={{ backgroundColor: "rgba(28, 25, 23, 0.32)" }}
        onClick={onClose}
      />
      <div className="relative flex h-full w-full max-w-md flex-col overflow-y-auto border-l border-stone-200 bg-white shadow-2xl">
        <div className="sticky top-0 z-10 border-b border-stone-200 bg-white px-5 py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-xs uppercase tracking-wide text-stone-500">{eyebrow}</div>
              <h2 className="mt-1 text-base font-semibold leading-snug">{title}</h2>
            </div>
            <button
              onClick={onClose}
              aria-label="Close"
              className="rounded p-1 text-stone-400 hover:bg-stone-100 hover:text-stone-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">{chips}</div>
        </div>
        <div className="space-y-5 px-5 py-5">{children}</div>
      </div>
    </div>
  );
}

function SettingDrawer({ entry, notes, onAddNote, onClose, onApply, onDismiss, onRevert }) {
  const rec = entry.rec;

  return (
    <DrawerShell
      eyebrow={entry.category}
      title={entry.name}
      onClose={onClose}
      chips={
        <>
          <Chip className={STATE_STYLE[entry.state]}>{entry.state}</Chip>
          <Chip className="bg-stone-100 text-stone-600 ring-stone-200">{entry.platform}</Chip>
          {entry.devices ? (
            <Chip className="bg-stone-100 text-stone-600 ring-stone-200">{entry.devices.toLocaleString()} devices</Chip>
          ) : null}
        </>
      }
    >
      {/* effective value */}
      <section>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-stone-500">Effective value</h3>
        {entry.conflict ? (
          <div className="mt-2 rounded-md border border-red-200 bg-red-50 p-3">
            <div className="flex gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
              <p className="text-xs leading-relaxed text-red-800">
                Two policies set this differently on overlapping groups. Devices apply whichever processes last, so the result is not
                predictable.
              </p>
            </div>
            <ul className="mt-3 space-y-1.5">
              {entry.sources.map((s, n) => (
                <li key={n} className="flex items-center justify-between gap-3 text-xs">
                  <span className="truncate text-red-900">{s.policy.name}</span>
                  <span className="shrink-0 rounded border border-red-200 bg-white px-1.5 py-0.5 font-medium text-red-800">
                    {s.setting.current}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="mt-2 rounded-md border border-stone-200 p-3">
            <div className="text-sm font-medium">{entry.value}</div>
            {entry.state === "Not deployed" && (
              <p className="mt-1 text-xs text-stone-500">
                Configured but not reaching any device, because the policy holding it has no group assigned.
              </p>
            )}
            {entry.state === "Staged" && <p className="mt-1 text-xs text-teal-600">Staged. Deploy from the change log to apply it.</p>}
          </div>
        )}
      </section>

      {entry.ref && <RefPath value={entry.ref} label={refLabel(entry.platform)} />}

      {/* recommendation */}
      {rec && !entry.isApplied && !entry.isDismissed && (
        <section className="rounded-md border border-stone-200 p-3">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0 text-amber-500" />
            <h3 className="text-sm font-semibold">Recommended change</h3>
            <Chip className={"ml-auto " + SEVERITY[rec.severity].chip}>{SEVERITY[rec.severity].label}</Chip>
          </div>
          <div className="mt-3">
            <Diff from={rec.current} to={rec.recommended} />
          </div>
          <p className="mt-3 text-xs leading-relaxed text-stone-600">{rec.why}</p>
          <p className="mt-2 text-xs text-stone-400">Source: {rec.source}</p>
          <div className="mt-3 flex gap-2">
            <button
              onClick={() => onApply(rec, entry.sources.find((s) => s.setting.id === rec.id).policy)}
              className="rounded-md bg-teal-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-teal-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
            >
              {rec.action || "Apply"}
            </button>
            <button
              onClick={() => onDismiss(rec.id)}
              className="rounded-md px-3 py-1.5 text-xs font-medium text-stone-600 ring-1 ring-inset ring-stone-300 hover:bg-stone-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
            >
              Dismiss
            </button>
          </div>
        </section>
      )}

      {rec && entry.isApplied && (
        <section className="rounded-md border border-teal-200 bg-teal-50 p-3">
          <p className="text-xs text-teal-900">Change staged: {rec.recommended}</p>
          <button
            onClick={() => onRevert(rec.id)}
            className="mt-2 rounded text-xs font-medium text-teal-700 hover:text-teal-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
          >
            Revert to {rec.current}
          </button>
        </section>
      )}

      {rec && entry.isDismissed && (
        <p className="rounded-md border border-stone-200 bg-stone-50 p-3 text-xs text-stone-500">
          Recommendation dismissed. It stays off the list until the baseline changes.
        </p>
      )}

      {!rec && !entry.conflict && (
        <p className="flex items-start gap-2 rounded-md border border-stone-200 bg-stone-50 p-3 text-xs leading-relaxed text-stone-600">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-stone-400" />
          Matches the baseline. Nothing to change.
        </p>
      )}

      {/* where it comes from */}
      <section>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-stone-500">Set by</h3>
        <ul className="mt-2 space-y-2">
          {entry.sources.map((s, n) => (
            <li key={n} className="rounded-md border border-stone-200 p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{s.policy.name}</div>
                  <div className="mt-0.5 text-xs text-stone-500">{s.policy.profile}</div>
                </div>
                <span className="shrink-0 rounded border border-stone-200 bg-stone-50 px-1.5 py-0.5 text-xs text-stone-700">
                  {s.setting.current}
                </span>
              </div>
              <div className="mt-2 flex items-center gap-1.5 text-xs text-stone-500">
                <Users className="h-3.5 w-3.5 shrink-0 text-stone-400" />
                {s.policy.groups.length ? s.policy.groups.join(", ") : <span className="text-stone-400">No groups assigned</span>}
              </div>
            </li>
          ))}
        </ul>
        {entry.sources.length > 1 && !entry.conflict && (
          <p className="mt-2 text-xs text-stone-500">
            Defined in {entry.sources.length} policies with the same value. Harmless, but worth consolidating.
          </p>
        )}
      </section>

      <NoteThread notes={notes} onAdd={onAddNote} />
    </DrawerShell>
  );
}

/* ------------------------------------------------------- policy drawer --- */

function PolicyDrawer({ item, applied, dismissed, notes, onAddNote, onClose, onApply, onDismiss, onRevert }) {
  const status = policyStatus(item, applied);
  const gaps = item.settings.filter((s) => s.recommended && !applied[s.id] && !dismissed[s.id]);

  return (
    <DrawerShell
      eyebrow={KINDS[item.kind].label}
      title={item.name}
      onClose={onClose}
      chips={
        <>
          <Chip className={STATUS_STYLE[status]}>{status}</Chip>
          <Chip className="bg-stone-100 text-stone-600 ring-stone-200">{item.platform}</Chip>
          <Chip className="bg-stone-100 text-stone-600 ring-stone-200">{item.profile}</Chip>
        </>
      }
    >
      <dl className="grid grid-cols-2 gap-3 text-sm">
        <div className="rounded-md border border-stone-200 p-3">
          <dt className="text-xs text-stone-500">Devices targeted</dt>
          <dd className="mt-1 font-medium tabular-nums">{item.devices.toLocaleString()}</dd>
        </div>
        <div className="rounded-md border border-stone-200 p-3">
          <dt className="text-xs text-stone-500">Succeeded</dt>
          <dd className="mt-1 font-medium tabular-nums">{item.devices ? pct(item.ok, item.devices) + "%" : "—"}</dd>
        </div>
        <div className="col-span-2 rounded-md border border-stone-200 p-3">
          <dt className="text-xs text-stone-500">Assigned to</dt>
          <dd className="mt-1 text-sm">{item.groups.length ? item.groups.join(", ") : <span className="text-stone-400">No groups</span>}</dd>
        </div>
        <div className="col-span-2 rounded-md border border-stone-200 p-3">
          <dt className="text-xs text-stone-500">Last modified</dt>
          <dd className="mt-1 text-sm">{item.updated}</dd>
        </div>
      </dl>

      <section>
        <div className="flex items-baseline justify-between">
          <h3 className="text-sm font-semibold">Settings</h3>
          <span className="text-xs text-stone-500">{gaps.length ? gaps.length + " differ from baseline" : "Matches baseline"}</span>
        </div>

        <ul className="mt-3 space-y-3">
          {item.settings.map((s) => {
            const isApplied = applied[s.id];
            const isDismissed = dismissed[s.id];
            const hasRec = Boolean(s.recommended);

            return (
              <li key={s.id} className="rounded-md border border-stone-200 p-3">
                <div className="flex items-start gap-2">
                  {hasRec && !isApplied && !isDismissed ? (
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                  ) : (
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-stone-300" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">{s.name}</div>
                    {s.ref && <code className="mt-0.5 block break-all font-mono text-xs text-stone-400">{s.ref}</code>}

                    {!hasRec && <div className="mt-1 text-sm text-stone-600">{s.current}</div>}

                    {hasRec && isApplied && (
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-sm">
                        <span className="font-medium text-stone-800">{s.recommended}</span>
                        <Chip className="bg-teal-50 text-teal-700 ring-teal-200">Staged</Chip>
                      </div>
                    )}

                    {hasRec && isDismissed && (
                      <div className="mt-1 text-sm text-stone-500">
                        {s.current} <span className="text-xs text-stone-400">· recommendation dismissed</span>
                      </div>
                    )}

                    {hasRec && !isApplied && !isDismissed && (
                      <div className="mt-2 space-y-2">
                        <Diff from={s.current} to={s.recommended} />
                        <p className="text-xs leading-relaxed text-stone-600">{s.why}</p>
                        <p className="text-xs text-stone-400">Source: {s.source}</p>
                        <div className="flex gap-2 pt-1">
                          <button
                            onClick={() => onApply(s, item)}
                            className="rounded-md bg-teal-800 px-2.5 py-1 text-xs font-medium text-white hover:bg-teal-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
                          >
                            {s.action || "Apply"}
                          </button>
                          <button
                            onClick={() => onDismiss(s.id)}
                            className="rounded-md px-2.5 py-1 text-xs font-medium text-stone-600 ring-1 ring-inset ring-stone-300 hover:bg-stone-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
                          >
                            Dismiss
                          </button>
                        </div>
                      </div>
                    )}

                    {hasRec && isApplied && (
                      <button
                        onClick={() => onRevert(s.id)}
                        className="mt-2 rounded text-xs font-medium text-stone-500 hover:text-stone-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
                      >
                        Revert to {s.current}
                      </button>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      <NoteThread notes={notes} onAdd={onAddNote} />
    </DrawerShell>
  );
}
