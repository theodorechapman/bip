/**
 * Reusable browser-use controller actions for phone OTP verification via JoltSMS.
 * Plug these into any provider's Controller to give the browser agent
 * the ability to receive SMS verification codes.
 */

import { Controller, ActionResult } from "browser-use";
import {
  reuseOrRentNumber,
  waitForOtp,
  type JoltNumber,
} from "../joltsms-client";

export type PhoneVerifyContext = {
  number: JoltNumber;
  phoneNumber: string;
};

/**
 * Registers phone verification actions on a browser-use Controller:
 *   - get_phone_number: Returns the agent's phone number to enter on forms
 *   - check_phone_otp:  Polls JoltSMS for an incoming OTP code
 *
 * Returns the phone context so the caller can use it in sensitive_data.
 */
export async function registerPhoneActions(
  controller: Controller,
): Promise<PhoneVerifyContext> {
  const number = await reuseOrRentNumber();
  const phoneNumber = number.phoneNumber;

  controller.registry.action(
    "Get the agent's phone number to enter on signup/verification forms. Returns the phone number string.",
    {},
  )(async function get_phone_number() {
    console.log(`   [Action] Providing phone number: ${phoneNumber}`);
    return new ActionResult({
      extracted_content: `Phone number: ${phoneNumber}`,
    });
  });

  controller.registry.action(
    "Check for an incoming SMS verification code (OTP). Call this after submitting a phone number on a form and waiting for the verification code to arrive. Returns the OTP code.",
    {},
  )(async function check_phone_otp() {
    console.log("   [Action] Waiting for SMS OTP...");
    const result = await waitForOtp(number.id, 120, 5);
    if (result) {
      console.log(`   [Action] OTP received: ${result.code}`);
      return new ActionResult({
        extracted_content: `SMS verification code: ${result.code}`,
      });
    }
    return new ActionResult({
      extracted_content: "No SMS verification code received within timeout.",
    });
  });

  return { number, phoneNumber };
}
