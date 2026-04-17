import { useState } from "react";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import FormField from "@cloudscape-design/components/form-field";
import Header from "@cloudscape-design/components/header";
import Input from "@cloudscape-design/components/input";
import Modal from "@cloudscape-design/components/modal";
import SpaceBetween from "@cloudscape-design/components/space-between";
import { submitOTP } from "../api/client";

interface OTPModalProps {
  visible: boolean;
  accountId: string;
  onDismiss: () => void;
  onSuccess: () => void;
}

export default function OTPModal({
  visible,
  accountId,
  onDismiss,
  onSuccess,
}: OTPModalProps) {
  const [otp, setOtp] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async () => {
    if (!otp.trim()) return;
    setLoading(true);
    setError("");
    try {
      await submitOTP({ account_id: accountId, otp: otp.trim() });
      setOtp("");
      onSuccess();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to submit OTP");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      visible={visible}
      onDismiss={onDismiss}
      header={<Header variant="h2">Enter OTP Code</Header>}
      footer={
        <Box float="right">
          <SpaceBetween direction="horizontal" size="xs">
            <Button variant="link" onClick={onDismiss}>
              Cancel
            </Button>
            <Button variant="primary" loading={loading} onClick={handleSubmit}>
              Submit
            </Button>
          </SpaceBetween>
        </Box>
      }
    >
      <SpaceBetween size="m">
        <FormField
          label="OTP Code"
          description="Enter the verification code sent to your email"
          errorText={error}
        >
          <Input
            value={otp}
            onChange={({ detail }) => setOtp(detail.value)}
            placeholder="123456"
            type="text"
          />
        </FormField>
      </SpaceBetween>
    </Modal>
  );
}
