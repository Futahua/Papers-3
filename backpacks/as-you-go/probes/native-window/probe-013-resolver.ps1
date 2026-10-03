# Assignment 013R — pure harness resolver for initial unique-title selection.
#
# Maps a list result to typed missing/ambiguous/success and NEVER mutates.
# Exact-title equality only (no substrings). Shared by the live harness and
# the probe fake tests so there is exactly one resolver implementation.
#
# Requires: Windows PowerShell 5.1 or PowerShell 7.

#Requires -Version 5.1

function Resolve-AygUniqueTarget {
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
