using System;
using System.Collections.Generic;
using System.Globalization;
using System.Reflection;

internal static class HoverInputBridgePolicyTests
{
    private static void Require(bool condition, string message)
    {
        if (!condition) throw new Exception(message);
    }

    public static int Main()
    {
        Type bridge = typeof(HoverInputBridge);
        Type policyType = bridge.GetNestedType("WidgetPolicy", BindingFlags.NonPublic);
        ConstructorInfo constructor = policyType.GetConstructor(BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic,
            null, new[] { typeof(int), typeof(IntPtr), typeof(bool), typeof(HashSet<string>) }, null);
        object initial = constructor.Invoke(new object[] { 17, new IntPtr(1234), false, new HashSet<string>() });
        Array policies = Array.CreateInstance(policyType, 1);
        policies.SetValue(initial, 0);
        bridge.GetField("policies", BindingFlags.Static | BindingFlags.NonPublic).SetValue(null, policies);

        MethodInfo apply = bridge.GetMethod("ApplyPolicyCommand", BindingFlags.Static | BindingFlags.NonPublic);
        string encoded = Convert.ToBase64String(System.Text.Encoding.UTF8.GetBytes("A\nShift+B"));
        string acknowledgement = (string)apply.Invoke(null, new object[] { new[] { "POLICY", "41", "17", "1", encoded } });
        Require(acknowledgement == "POLICY_ACK\t41\tOK\t-", "successful native POLICY record must acknowledge its request ID");

        Array updatedPolicies = (Array)bridge.GetMethod("Snapshot", BindingFlags.Static | BindingFlags.NonPublic).Invoke(null, null);
        object updated = updatedPolicies.GetValue(0);
        Require((bool)policyType.GetField("Enabled").GetValue(updated), "policy must be updated before positive acknowledgement");
        var blocked = (HashSet<string>)policyType.GetField("Blocked").GetValue(updated);
        Require(blocked.Contains("A") && blocked.Contains("Shift+B"), "native parser must preserve blocked bindings");

        string missingWidgetAck = (string)apply.Invoke(null, new object[] { new[] { "POLICY", "42", "18", "0", "" } });
        Require(missingWidgetAck == "POLICY_ACK\t42\tERROR\twidget-not-found", "unknown widget must receive a correlated error acknowledgement");
        try
        {
            apply.Invoke(null, new object[] { new[] { "POLICY", "0", "17", "1", "" } });
            throw new Exception("zero request ID must be rejected");
        }
        catch (TargetInvocationException error)
        {
            Require(error.InnerException is FormatException, "malformed request ID must fail closed");
        }
        return 0;
    }
}
