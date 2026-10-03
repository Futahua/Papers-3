# Papers-owned pure resolver for initial unique-title selection (window
# helper, protocol snapshot 013R5F).
#
# Maps a list result to typed missing/ambiguous/success and NEVER mutates.
# Exact-title equality only (no substrings). Shared by the live harness and
# the fake tests so there is exactly one resolver implementation.
#
# Requires: Windows PowerShell 5.1 or PowerShell 7.

#Requires -Version 5.1

function Resolve-WhUniqueTarget {
  param([object[]]$Windows, [string]$UniqueTitle)
  $matches = @($Windows | Where-Object { [string]$_.title -eq $UniqueTitle })
  if ($matches.Count -eq 0) { return @{ outcome = 'missing' } }
  if ($matches.Count -gt 1) { return @{ outcome = 'ambiguous' } }
  return @{
    outcome = 'success'
    runtimeId = [string]$matches[0].runtimeId
    pid = [int]$matches[0].processId
    title = [string]$matches[0].title
  }
}
