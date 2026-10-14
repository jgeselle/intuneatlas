# Security policy

## Supported versions

Security fixes go into the latest release only. That covers the
standalone binaries on the
[Releases page](https://github.com/jgeselle/intuneatlas/releases) and
the container image `ghcr.io/jgeselle/intuneatlas`. If you run an older
version, please update before reporting, in case the problem is already
fixed.

## Reporting a vulnerability

Please **don't open a public issue** for a security problem.

Report it privately through GitHub instead: open the
[Security tab](https://github.com/jgeselle/intuneatlas/security) of this
repository and choose **Report a vulnerability**. Only the maintainer
can see the report until a fix is published.

If that option isn't available to you, open an issue that only asks how
to get in touch about a security matter, without any details of the
problem.

A useful report includes:

- the IntuneAtlas version, and how it runs (on your own machine, shared
  on your own server, or on Azure Container Apps);
- what someone could do, and what they would need first (for example,
  a signed-in Viewer, or no sign-in at all);
- the steps to reproduce it, as small as you can make them.

Please leave real tenant data, tokens and secrets out of the report.

## What happens next

This is a project maintained by one person in their own time, so these
are aims rather than guarantees:

- an acknowledgement within 7 days;
- an assessment, and a plan for a fix, as soon as reasonably possible;
- a fixed release, followed by a published security advisory.

Please keep the problem private until a fix is released, or for 90 days
after your report, whichever comes first, unless we agree on something
else. With your permission you'll be credited in the advisory.

## What's in scope

IntuneAtlas reads a Microsoft Intune tenant through Microsoft Graph and,
when an Admin pushes a reviewed change, writes to it. Worth reporting:

- anything that lets a signed-in person do more than their IntuneAtlas
  role (Viewer, Contributor, Admin) allows, such as staging, reviewing
  or pushing without the right role;
- anything that lets someone see policies their own Intune role doesn't
  show them on a shared instance;
- anything that writes to the tenant other than the reviewed change
  being pushed, or writes without that push;
- anything that lets a request without a sign-in reach data or actions
  that need one;
- cross-site scripting or injection, including through names and values
  read from a tenant, path traversal, and redirects to other sites after
  sign-in;
- problems with how sign-in sessions and tokens are kept;
- the release process and its supply chain: the published binaries, the
  container image, the build attestations, and the Azure deployment
  template in this repository.

## What's likely out of scope

- Denial of service against an instance you run yourself; that belongs
  to the network in front of it.
- Anything that needs the app registration's client secret, or admin
  rights over the server or the Azure resources it runs in, to begin
  with.
- Problems in Microsoft Intune, Microsoft Graph or Microsoft Entra
  themselves. Please report those to the
  [Microsoft Security Response Center](https://msrc.microsoft.com/).
- Forks, and builds not published from this repository.

## Testing

Only test against a tenant and an instance that you own or are allowed
to test. Please don't access, change or delete data that isn't yours,
and stop as soon as you've shown the problem.
