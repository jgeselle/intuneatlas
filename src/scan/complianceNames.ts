/**
 * What Intune's portal calls each compliance setting, and the section it
 * lists it under.
 *
 * Graph doesn't publish this: a typed compliance policy's settings are
 * bare property names (`passwordMinimumCharacterSetCount`), while the
 * portal shows "Password complexity" under "System Security". The names
 * and sections here are taken from Microsoft's compliance settings
 * reference on Microsoft Learn (the "compliance-policy-create-…" pages
 * for Windows, iOS/iPadOS, macOS, Android device administrator and
 * Android Enterprise, read 2026-10-08), matched by hand to the property
 * each one sets. A property that reference doesn't list — Graph has
 * several the portal never shows on their own — keeps the name derived
 * from its property name (see humanize in complianceSettings.ts).
 *
 * `COMMON` holds what is called the same on every platform that has the
 * property; `BY_TYPE` what one policy type calls differently.
 */
type Named = readonly [name: string, section: string];

const HEALTH = "Device Health";
const PROPERTIES = "Device Properties";
const SECURITY = "System Security";
const DEFENDER = "Microsoft Defender for Endpoint";
const WORK_PROFILE = "Work Profile Security";

const COMMON: Record<string, Named> = {
  osMinimumVersion: ["Minimum OS version", PROPERTIES],
  osMaximumVersion: ["Maximum OS version", PROPERTIES],
  osMinimumBuildVersion: ["Minimum OS build version", PROPERTIES],
  osMaximumBuildVersion: ["Maximum OS build version", PROPERTIES],
  minAndroidSecurityPatchLevel: ["Minimum security patch level", PROPERTIES],
  passwordRequired: ["Require a password to unlock mobile devices", SECURITY],
  passwordMinimumLength: ["Minimum password length", SECURITY],
  passwordMinutesOfInactivityBeforeLock: ["Maximum minutes of inactivity before password is required", SECURITY],
  passwordPreviousPasswordBlockCount: ["Number of previous passwords to prevent reuse", SECURITY],
  passwordBlockSimple: ["Simple passwords", SECURITY],
  storageRequireEncryption: ["Require encryption of data storage on device", SECURITY],
  restrictedApps: ["Restricted apps", SECURITY],
  securityBlockJailbrokenDevices: ["Rooted devices", HEALTH],
  deviceThreatProtectionRequiredSecurityLevel: ["Require the device to be at or under the Device Threat Level", HEALTH],
  advancedThreatProtectionRequiredSecurityLevel: ["Require the device to be at or under the machine risk score", DEFENDER],
};

/** Android, shared by device administrator and the Android Enterprise types. */
const ANDROID: Record<string, Named> = {
  securityBlockDeviceAdministratorManagedDevices: ["Devices managed with device administrator", HEALTH],
  securityRequireGooglePlayServices: ["Google Play Services is configured", HEALTH],
  securityRequireUpToDateSecurityProviders: ["Up-to-date security provider", HEALTH],
  securityRequireVerifyApps: ["Threat scan on apps", HEALTH],
  // One "Play integrity verdict" dropdown in the portal, two switches and an evaluation type in Graph.
  securityRequireSafetyNetAttestationBasicIntegrity: ["Play integrity verdict: check basic integrity", HEALTH],
  securityRequireSafetyNetAttestationCertifiedDevice: ["Play integrity verdict: check device integrity", HEALTH],
  securityRequiredAndroidSafetyNetEvaluationType: ["Check strong integrity using hardware-backed security features", HEALTH],
  securityPreventInstallAppsFromUnknownSources: ["Block apps from unknown sources", SECURITY],
  securityRequireCompanyPortalAppIntegrity: ["Company Portal app runtime integrity", SECURITY],
  securityRequireIntuneAppIntegrity: ["Intune app runtime integrity", SECURITY],
  securityDisableUsbDebugging: ["Block USB debugging on device", SECURITY],
  requiredPasswordComplexity: ["Password complexity", SECURITY],
  passwordRequiredType: ["Required password type", SECURITY],
  passwordExpirationDays: ["Number of days until password expires", SECURITY],
  passwordMinimumLetterCharacters: ["Number of characters required", SECURITY],
  passwordMinimumLowerCaseCharacters: ["Number of lowercase characters required", SECURITY],
  passwordMinimumUpperCaseCharacters: ["Number of uppercase characters required", SECURITY],
  passwordMinimumNonLetterCharacters: ["Number of non-letter characters required", SECURITY],
  passwordMinimumNumericCharacters: ["Number of numeric characters required", SECURITY],
  passwordMinimumSymbolCharacters: ["Number of symbol characters required", SECURITY],
  passwordPreviousPasswordCountToBlock: ["Number of passwords required before user can reuse a password", SECURITY],
  // The work profile's own password: the same names again, in a section of their own.
  workProfileRequirePassword: ["Require a password to unlock work profile", WORK_PROFILE],
  workProfilePasswordExpirationInDays: ["Number of days until password expires", WORK_PROFILE],
  workProfilePreviousPasswordBlockCount: ["Number of previous passwords to prevent reuse", WORK_PROFILE],
  workProfileInactiveBeforeScreenLockInMinutes: ["Maximum minutes of inactivity before password is required", WORK_PROFILE],
  workProfileRequiredPasswordComplexity: ["Password complexity", WORK_PROFILE],
  workProfilePasswordRequiredType: ["Required password type", WORK_PROFILE],
  workProfilePasswordMinimumLength: ["Minimum password length", WORK_PROFILE],
};

const APPLE_PASSWORD: Record<string, Named> = {
  passwordExpirationDays: ["Password expiration (days)", SECURITY],
  passwordMinimumCharacterSetCount: ["Number of non-alphanumeric characters in password", SECURITY],
};

const BY_TYPE: Record<string, Record<string, Named>> = {
  windows10: {
    bitLockerEnabled: ["Require BitLocker", HEALTH],
    secureBootEnabled: ["Require Secure Boot to be enabled on the device", HEALTH],
    codeIntegrityEnabled: ["Require code integrity", HEALTH],
    mobileOsMinimumVersion: ["Minimum OS required for mobile devices", PROPERTIES],
    mobileOsMaximumVersion: ["Maximum OS required for mobile devices", PROPERTIES],
    validOperatingSystemBuildRanges: ["Valid operating system builds", PROPERTIES],
    configurationManagerComplianceRequired: ["Require device compliance from Configuration Manager", "Configuration Manager Compliance"],
    passwordRequiredType: ["Password type", SECURITY],
    passwordMinimumCharacterSetCount: ["Password complexity", SECURITY],
    passwordExpirationDays: ["Password expiration (days)", SECURITY],
    passwordRequiredToUnlockFromIdle: ["Require password when device returns from idle state (Mobile and Holographic)", SECURITY],
    storageRequireEncryption: ["Encryption of data storage on a device", SECURITY],
    activeFirewallRequired: ["Firewall", SECURITY],
    tpmRequired: ["Trusted Platform Module (TPM)", SECURITY],
    antivirusRequired: ["Antivirus", SECURITY],
    antiSpywareRequired: ["Antispyware", SECURITY],
    defenderEnabled: ["Microsoft Defender Antimalware", SECURITY],
    defenderVersion: ["Microsoft Defender Antimalware minimum version", SECURITY],
    signatureOutOfDate: ["Microsoft Defender Antimalware security intelligence up-to-date", SECURITY],
    rtpEnabled: ["Real-time protection", SECURITY],
    // On Windows the Defender for Endpoint risk score is this property; mobile platforms have a separate one.
    deviceThreatProtectionRequiredSecurityLevel: ["Require the device to be at or under the machine risk score", DEFENDER],
    deviceThreatProtectionEnabled: ["Device threat protection enabled", DEFENDER],
    wslDistributions: ["WSL distributions", "Windows Subsystem for Linux"],
    deviceCompliancePolicyScript: ["Device compliance policy script", "Custom Compliance"],
  },
  ios: {
    managedEmailProfileRequired: ["Unable to set up email on the device", "Email"],
    securityBlockJailbrokenDevices: ["Jailbroken devices", HEALTH],
    passcodeRequired: ["Require a password to unlock mobile devices", SECURITY],
    passcodeBlockSimple: ["Simple passwords", SECURITY],
    passcodeMinimumLength: ["Minimum password length", SECURITY],
    passcodeRequiredType: ["Required password type", SECURITY],
    passcodeMinimumCharacterSetCount: ["Number of non-alphanumeric characters in password", SECURITY],
    passcodeMinutesOfInactivityBeforeLock: ["Maximum minutes after screen lock before password is required", SECURITY],
    passcodeMinutesOfInactivityBeforeScreenTimeout: ["Maximum minutes of inactivity until screen locks", SECURITY],
    passcodeExpirationDays: ["Password expiration (days)", SECURITY],
    passcodePreviousPasscodeBlockCount: ["Number of previous passwords to prevent reuse", SECURITY],
  },
  macOS: {
    ...APPLE_PASSWORD,
    systemIntegrityProtectionEnabled: ["Require a system integrity protection", HEALTH],
    passwordRequired: ["Require a password to unlock devices", SECURITY],
    passwordRequiredType: ["Password type", SECURITY],
    firewallEnabled: ["Firewall", SECURITY],
    firewallBlockAllIncoming: ["Incoming connections", SECURITY],
    firewallEnableStealthMode: ["Stealth Mode", SECURITY],
    gatekeeperAllowedAppSource: ["Allow apps downloaded from these locations", SECURITY],
    deviceCompliancePolicyScript: ["Device compliance policy script", "Custom Compliance"],
  },
  android: ANDROID,
  androidWorkProfile: ANDROID,
  androidForWork: ANDROID,
  androidDeviceOwner: ANDROID,
  aospDeviceOwner: ANDROID,
};

/** The portal's name and section for a typed compliance policy's property, where the reference lists it. */
export function portalNameOf(type: string, property: string): { name: string; section: string } | undefined {
  const found = BY_TYPE[type]?.[property] ?? COMMON[property];
  return found ? { name: found[0], section: found[1] } : undefined;
}
