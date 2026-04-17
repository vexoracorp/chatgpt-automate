import { useEffect, useState } from "react";
import { Outlet, useNavigate, useLocation } from "react-router-dom";
import AppLayout from "@cloudscape-design/components/app-layout";
import SideNavigation from "@cloudscape-design/components/side-navigation";
import TopNavigation from "@cloudscape-design/components/top-navigation";
import { useAuth } from "../context/AuthContext";
import { getSettings } from "../api/client";
import ProfileModal from "../pages/ProfilePage";

export default function Layout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, role, logout } = useAuth();
  const [orgName, setOrgName] = useState("ChatGPT Account Manager");
  const [profileOpen, setProfileOpen] = useState(false);

  useEffect(() => {
    getSettings().then((s) => setOrgName(s.org_name)).catch(() => {});
  }, []);

  const isAdmin = role === "admin" || role === "owner";

  const navItems: Parameters<typeof SideNavigation>[0]["items"] = [
    {
      type: "section",
      text: "Automation",
      items: [
        { type: "link", text: "Accounts", href: "/" },
        { type: "link", text: "Workflows", href: "/workflows" },
      ],
    },
    {
      type: "section",
      text: "Infrastructure",
      items: [
        { type: "link", text: "Proxies", href: "/proxies" },
        { type: "link", text: "Mailboxes", href: "/mailboxes" },
      ],
    },
    {
      type: "section",
      text: "Organization",
      items: [
        { type: "link", text: "Users", href: "/users" },
        ...(isAdmin
          ? [{ type: "link" as const, text: "Settings", href: "/settings" }]
          : []),
      ],
    },
  ];

  return (
    <>
      <TopNavigation
        identity={{ href: "/", title: orgName }}
        utilities={[
          {
            type: "menu-dropdown",
            text: user?.email ?? "",
            iconName: "user-profile",
            items: [
              { id: "profile", text: "Profile" },
              { id: "signout", text: "Sign out" },
            ],
            onItemClick: ({ detail }) => {
              if (detail.id === "signout") logout();
              if (detail.id === "profile") setProfileOpen(true);
            },
          },
        ]}
      />
      <AppLayout
        toolsHide
        navigation={
          <SideNavigation
            activeHref={location.pathname}
            onFollow={(e) => {
              e.preventDefault();
              navigate(e.detail.href);
            }}
            items={navItems}
          />
        }
        content={<Outlet />}
      />
      <ProfileModal visible={profileOpen} onDismiss={() => setProfileOpen(false)} />
    </>
  );
}
