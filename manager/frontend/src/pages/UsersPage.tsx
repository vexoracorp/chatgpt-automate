import { useEffect, useState, useCallback } from "react";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import ColumnLayout from "@cloudscape-design/components/column-layout";
import FormField from "@cloudscape-design/components/form-field";
import Header from "@cloudscape-design/components/header";
import Input from "@cloudscape-design/components/input";
import Modal from "@cloudscape-design/components/modal";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Table from "@cloudscape-design/components/table";
import Alert from "@cloudscape-design/components/alert";
import Select, { type SelectProps } from "@cloudscape-design/components/select";
import { type User, fetchUsers, createUser, deleteUser, resetUserPassword, updateUser } from "../api/client";
import { useAuth } from "../context/AuthContext";

const ROLE_OPTIONS: SelectProps.Option[] = [
  { value: "owner", label: "Owner" },
  { value: "admin", label: "Admin" },
  { value: "manager", label: "Manager" },
  { value: "user", label: "User" },
];

export default function UsersPage() {
  const { role: callerRole } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<User[]>([]);
  const [modalVisible, setModalVisible] = useState(false);
  const [detailUser, setDetailUser] = useState<User | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<SelectProps.Option>(ROLE_OPTIONS[3]);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [resetLoading, setResetLoading] = useState(false);
  const [resetSuccess, setResetSuccess] = useState("");
  const [resetError, setResetError] = useState("");
  
  const [detailEmail, setDetailEmail] = useState("");
  const [detailName, setDetailName] = useState("");
  const [detailRole, setDetailRole] = useState<SelectProps.Option>(ROLE_OPTIONS[3]);
  const [updating, setUpdating] = useState(false);
  const [updateError, setUpdateError] = useState("");
  const [updateSuccess, setUpdateSuccess] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setUsers(await fetchUsers());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const resetForm = () => {
    setEmail("");
    setPassword("");
    setName("");
    setRole(ROLE_OPTIONS[3]);
    setError("");
  };

  const handleCreate = async () => {
    if (!email || !password) return;
    setCreating(true);
    setError("");
    try {
      await createUser({ email, password, name: name || undefined, role: role.value });
      resetForm();
      setModalVisible(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create user");
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async () => {
    for (const u of selected) {
      await deleteUser(u.id);
    }
    setSelected([]);
    await load();
  };

  const openDetail = (user: User) => {
    setDetailUser(user);
    setDetailEmail(user.email);
    setDetailName(user.name || "");
    setDetailRole(ROLE_OPTIONS.find(o => o.value === (user.role || "user")) || ROLE_OPTIONS[3]);
    setNewPassword("");
    setResetSuccess("");
    setResetError("");
    setUpdateError("");
    setUpdateSuccess("");
  };

  const handleUpdate = async () => {
    if (!detailUser) return;
    setUpdating(true);
    setUpdateError("");
    setUpdateSuccess("");
    try {
      await updateUser(detailUser.id, {
        email: detailEmail,
        name: detailName || undefined,
        role: detailRole.value,
      });
      setUpdateSuccess("User updated successfully");
      await load();
    } catch (e) {
      setUpdateError(e instanceof Error ? e.message : "Failed to update user");
    } finally {
      setUpdating(false);
    }
  };

  const handleResetPassword = async () => {
    if (!detailUser || !newPassword) return;
    setResetLoading(true);
    setResetError("");
    setResetSuccess("");
    try {
      await resetUserPassword(detailUser.id, newPassword);
      setNewPassword("");
      setResetSuccess("Password reset successfully");
    } catch (e) {
      setResetError(e instanceof Error ? e.message : "Failed to reset password");
    } finally {
      setResetLoading(false);
    }
  };

  const isReadOnly = callerRole === "user" || callerRole === "manager";
  const canEditDetail = (detailUser: User | null) => {
    if (!detailUser) return false;
    if (callerRole === "owner") return true;
    if (callerRole === "admin") {
      return detailUser.role !== "owner" && detailUser.role !== "admin";
    }
    return false;
  };

  return (
    <SpaceBetween size="l">
      <Modal
        visible={modalVisible}
        onDismiss={() => { setModalVisible(false); resetForm(); }}
        header={<Header variant="h2">Create User</Header>}
        footer={
          <Box float="right">
            <SpaceBetween direction="horizontal" size="xs">
              <Button variant="link" onClick={() => { setModalVisible(false); resetForm(); }}>Cancel</Button>
              <Button variant="primary" loading={creating} onClick={handleCreate} disabled={!email || !password}>Create</Button>
            </SpaceBetween>
          </Box>
        }
      >
        <SpaceBetween size="l">
          {error && <Alert type="error">{error}</Alert>}
          <FormField label="Email">
            <Input value={email} onChange={({ detail }) => setEmail(detail.value)} placeholder="admin@example.com" type="email" />
          </FormField>
          <FormField label="Name">
            <Input value={name} onChange={({ detail }) => setName(detail.value)} placeholder="John Doe" />
          </FormField>
          <FormField label="Password">
            <Input value={password} onChange={({ detail }) => setPassword(detail.value)} type="password" />
          </FormField>
          <FormField label="Role">
            <Select
              selectedOption={role}
              onChange={({ detail }) => setRole(detail.selectedOption)}
              options={ROLE_OPTIONS}
            />
          </FormField>
        </SpaceBetween>
      </Modal>

      <Modal
        visible={!!detailUser}
        size="large"
        onDismiss={() => setDetailUser(null)}
        header={<Header variant="h2">{detailUser?.name || detailUser?.email}</Header>}
        footer={
          <Box float="right">
            <SpaceBetween direction="horizontal" size="xs">
              <Button onClick={() => setDetailUser(null)}>Close</Button>
              {canEditDetail(detailUser) && (
                <Button variant="primary" loading={updating} onClick={handleUpdate}>Save</Button>
              )}
            </SpaceBetween>
          </Box>
        }
      >
        {detailUser && (
          <SpaceBetween size="l">
            {updateSuccess && <Alert type="success">{updateSuccess}</Alert>}
            {updateError && <Alert type="error">{updateError}</Alert>}
            
            <ColumnLayout columns={2} variant="text-grid">
              <FormField label="Email">
                {canEditDetail(detailUser) ? (
                  <Input value={detailEmail} onChange={({ detail }) => setDetailEmail(detail.value)} type="email" />
                ) : (
                  <div>{detailUser.email}</div>
                )}
              </FormField>
              <FormField label="Name">
                {canEditDetail(detailUser) ? (
                  <Input value={detailName} onChange={({ detail }) => setDetailName(detail.value)} />
                ) : (
                  <div>{detailUser.name || "-"}</div>
                )}
              </FormField>
              <FormField label="Role">
                {canEditDetail(detailUser) ? (
                  <Select
                    selectedOption={detailRole}
                    onChange={({ detail }) => setDetailRole(detail.selectedOption)}
                    options={ROLE_OPTIONS}
                  />
                ) : (
                  <div>{ROLE_OPTIONS.find(o => o.value === (detailUser.role || "user"))?.label || detailUser.role || "User"}</div>
                )}
              </FormField>
              <FormField label="Created">
                <div>{detailUser.created_at}</div>
              </FormField>
              <FormField label="Last Login">
                <div>{detailUser.last_login || "Never"}</div>
              </FormField>
            </ColumnLayout>

            {canEditDetail(detailUser) && (
              <>
                <Header variant="h3">Reset Password</Header>
                {resetSuccess && <Alert type="success">{resetSuccess}</Alert>}
                {resetError && <Alert type="error">{resetError}</Alert>}
                <SpaceBetween direction="horizontal" size="xs">
                  <FormField>
                    <Input
                      value={newPassword}
                      onChange={({ detail }) => setNewPassword(detail.value)}
                      type="password"
                      placeholder="New password"
                    />
                  </FormField>
                  <Button
                    loading={resetLoading}
                    onClick={handleResetPassword}
                    disabled={!newPassword}
                  >
                    Reset Password
                  </Button>
                </SpaceBetween>
              </>
            )}
          </SpaceBetween>
        )}
      </Modal>

      <Table
        header={
          <Header
            counter={`(${users.length})`}
            actions={
              <SpaceBetween direction="horizontal" size="xs">
                <Button onClick={load} iconName="refresh" loading={loading} />
                {!isReadOnly && (
                  <>
                    <Button disabled={selected.length === 0} onClick={handleDelete}>Delete</Button>
                    <Button variant="primary" onClick={() => { resetForm(); setModalVisible(true); }}>Create User</Button>
                  </>
                )}
              </SpaceBetween>
            }
          >
            Users
          </Header>
        }
        items={users}
        loading={loading}
        loadingText="Loading users..."
        selectionType={isReadOnly ? undefined : "multi"}
        selectedItems={selected}
        onSelectionChange={({ detail }) => setSelected(detail.selectedItems)}
        empty={
          <Box textAlign="center" color="inherit">
            <SpaceBetween size="m">
              <b>No users</b>
              {!isReadOnly && <Button onClick={() => setModalVisible(true)}>Create User</Button>}
            </SpaceBetween>
          </Box>
        }
        columnDefinitions={[
          { id: "name", header: "Name", cell: (item) => item.name || "-" },
          { id: "email", header: "Email", cell: (item) => item.email },
          { id: "role", header: "Role", cell: (item) => item.role || "user" },
          { id: "last_login", header: "Last Login", cell: (item) => item.last_login || "Never" },
          { id: "created_at", header: "Created", cell: (item) => item.created_at },
          {
            id: "actions",
            header: "Actions",
            cell: (item) => (
              <Button variant="inline-link" onClick={() => openDetail(item)}>
                Details
              </Button>
            ),
            width: 90,
          },
        ]}
      />
    </SpaceBetween>
  );
}
