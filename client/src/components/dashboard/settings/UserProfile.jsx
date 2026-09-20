import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import {
  User,
  Mail,
  Briefcase,
  Upload,
  Trash2,
  Lock,
  Save,
  CheckCircle2,
  Sparkles,
} from "lucide-react";
import {
  getUserProfileApi,
  updateUserProfileApi,
} from "../../../services/user.service";
import { useToast } from "../ToastContext";

export default function UserProfile() {
  const { showToast } = useToast();
  const [isAvatarExpanded, setIsAvatarExpanded] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [initialProfile, setInitialProfile] = useState(null);
  const [profile, setProfile] = useState({
    name: "",
    email: "",
    jobTitle: "",
    bio: "",
    avatarUrl: "",
  });

  useEffect(() => {
    const fetchProfile = async () => {
      try {
        const data = await getUserProfileApi();
        const loaded = {
          name: data?.name || "",
          email: data?.email || "",
          jobTitle: data?.jobTitle || "",
          bio: data?.bio || "",
          avatarUrl: data?.avatarUrl || "",
        };
        setProfile(loaded);
        setInitialProfile(loaded);
      } catch (error) {
        console.error("Error fetching user profile:", error);
      }
    };
    fetchProfile();
  }, []);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await updateUserProfileApi(profile);
      setInitialProfile(profile);
      showToast({
        type: "success",
        title: "Profile Saved",
        message: "Your profile information has been updated successfully.",
      });
    } catch (error) {
      console.error("Error updating profile:", error);
      showToast({
        type: "error",
        title: "Update Failed",
        message: "Could not save profile changes. Please try again.",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancel = () => {
    if (initialProfile) {
      setProfile(initialProfile);
      showToast({
        type: "info",
        title: "Changes Reverted",
        message: "Profile inputs have been reset to previous values.",
      });
    }
  };

  const getInitials = (name) => {
    if (!name) return "U";
    return name
      .split(" ")
      .map((n) => n[0])
      .slice(0, 2)
      .join("")
      .toUpperCase();
  };

  return (
    <div
      style={{
        maxWidth: "920px",
        padding: "32px 28px 64px",
        fontFamily: "var(--font-sans)",
        color: "#e6edf3",
      }}
    >
      {/* Header */}
      <div style={{ marginBottom: "28px" }}>
        <h1
          style={{
            fontSize: "22px",
            fontWeight: 700,
            color: "#e6edf3",
            marginBottom: "6px",
            display: "flex",
            alignItems: "center",
            gap: "10px",
          }}
        >
          <User size={22} style={{ color: "#a78bfa" }} />
          User Profile
        </h1>
        <p style={{ color: "#8b949e", fontSize: "13px", margin: 0 }}>
          Manage your public identity, personal details, and profile avatar.
        </p>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
        {/* Profile Avatar Card */}
        <div
          style={{
            background: "rgba(255, 255, 255, 0.025)",
            border: "1px solid rgba(255, 255, 255, 0.08)",
            borderRadius: "14px",
            padding: "24px",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "24px",
              flexWrap: "wrap",
            }}
          >
            <div
              style={{
                width: "84px",
                height: "84px",
                borderRadius: "50%",
                background:
                  "linear-gradient(135deg, rgba(124, 58, 237, 0.4), rgba(34, 211, 238, 0.2))",
                overflow: "hidden",
                border: "2px solid rgba(124, 58, 237, 0.4)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: profile.avatarUrl ? "pointer" : "default",
                boxShadow: "0 0 16px rgba(124, 58, 237, 0.2)",
                flexShrink: 0,
              }}
              onClick={() => profile.avatarUrl && setIsAvatarExpanded(true)}
            >
              {profile.avatarUrl ? (
                <img
                  src={profile.avatarUrl}
                  alt="Avatar"
                  style={{ width: "100%", height: "100%", objectFit: "cover" }}
                />
              ) : (
                <div
                  style={{
                    color: "#c4b5fd",
                    fontSize: "24px",
                    fontWeight: 700,
                    letterSpacing: "0.05em",
                  }}
                >
                  {getInitials(profile.name)}
                </div>
              )}
            </div>

            {isAvatarExpanded && (
              <div
                style={{
                  position: "fixed",
                  top: 0,
                  left: 0,
                  width: "100%",
                  height: "100%",
                  background: "rgba(0,0,0,0.85)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  zIndex: 1000,
                  backdropFilter: "blur(8px)",
                }}
                onClick={() => setIsAvatarExpanded(false)}
              >
                <img
                  src={profile.avatarUrl}
                  alt="Expanded Avatar"
                  style={{
                    maxWidth: "80%",
                    maxHeight: "80%",
                    borderRadius: "12px",
                    boxShadow: "0 8px 32px rgba(0,0,0,0.8)",
                  }}
                />
              </div>
            )}

            <input
              type="file"
              id="avatar-upload"
              style={{ display: "none" }}
              accept="image/*"
              onChange={(e) => {
                if (e.target.files && e.target.files[0]) {
                  const reader = new FileReader();
                  reader.onload = (event) => {
                    setProfile({ ...profile, avatarUrl: event.target.result });
                    showToast({
                      type: "info",
                      title: "Photo Selected",
                      message: "Remember to click 'Save Changes' to apply.",
                    });
                  };
                  reader.readAsDataURL(e.target.files[0]);
                }
              }}
            />

            <div>
              <h3
                style={{
                  fontSize: "15px",
                  fontWeight: 600,
                  color: "#e6edf3",
                  margin: "0 0 6px 0",
                }}
              >
                Profile Photo
              </h3>
              <p
                style={{
                  fontSize: "12px",
                  color: "#8b949e",
                  margin: "0 0 12px 0",
                }}
              >
                PNG, JPG, or GIF up to 2MB. Recommended 256x256px.
              </p>
              <div style={{ display: "flex", gap: "10px" }}>
                <button
                  type="button"
                  onClick={() =>
                    document.getElementById("avatar-upload").click()
                  }
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                    padding: "7px 14px",
                    borderRadius: "8px",
                    background: "rgba(124, 58, 237, 0.15)",
                    border: "1px solid rgba(124, 58, 237, 0.35)",
                    fontSize: "12px",
                    fontWeight: 500,
                    color: "#c4b5fd",
                    cursor: "pointer",
                  }}
                >
                  <Upload size={13} />
                  Change Avatar
                </button>
                {profile.avatarUrl && (
                  <button
                    type="button"
                    onClick={() => setProfile({ ...profile, avatarUrl: "" })}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "6px",
                      padding: "7px 14px",
                      borderRadius: "8px",
                      background: "rgba(239, 68, 68, 0.08)",
                      border: "1px solid rgba(239, 68, 68, 0.25)",
                      fontSize: "12px",
                      fontWeight: 500,
                      color: "#f87171",
                      cursor: "pointer",
                    }}
                  >
                    <Trash2 size={13} />
                    Remove
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Personal Details Card */}
        <div
          style={{
            background: "rgba(255, 255, 255, 0.025)",
            border: "1px solid rgba(255, 255, 255, 0.08)",
            borderRadius: "14px",
            padding: "24px",
          }}
        >
          <h3
            style={{
              fontSize: "15px",
              fontWeight: 600,
              color: "#e6edf3",
              margin: "0 0 18px 0",
            }}
          >
            Personal Information
          </h3>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
              gap: "20px",
              marginBottom: "20px",
            }}
          >
            {/* Full Name */}
            <div>
              <label
                style={{
                  display: "block",
                  fontSize: "12px",
                  fontWeight: 500,
                  color: "#8b949e",
                  marginBottom: "6px",
                }}
              >
                Full Name
              </label>
              <div style={{ position: "relative" }}>
                <input
                  type="text"
                  value={profile.name}
                  placeholder="e.g. Jane Doe"
                  style={{
                    width: "100%",
                    background: "rgba(0, 0, 0, 0.35)",
                    border: "1px solid rgba(255, 255, 255, 0.12)",
                    borderRadius: "8px",
                    padding: "9px 12px",
                    fontSize: "13px",
                    color: "#e6edf3",
                    outline: "none",
                  }}
                  onChange={(e) =>
                    setProfile({ ...profile, name: e.target.value })
                  }
                />
              </div>
            </div>

            {/* Email Address */}
            <div>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  marginBottom: "6px",
                }}
              >
                <label
                  style={{
                    fontSize: "12px",
                    fontWeight: 500,
                    color: "#8b949e",
                  }}
                >
                  Email Address
                </label>
                <span
                  style={{
                    fontSize: "11px",
                    color: "#4ade80",
                    display: "flex",
                    alignItems: "center",
                    gap: "4px",
                  }}
                >
                  <CheckCircle2 size={11} />
                  Verified
                </span>
              </div>
              <div style={{ position: "relative" }}>
                <input
                  type="text"
                  value={profile.email}
                  style={{
                    width: "100%",
                    background: "rgba(0, 0, 0, 0.2)",
                    border: "1px solid rgba(255, 255, 255, 0.06)",
                    borderRadius: "8px",
                    padding: "9px 36px 9px 12px",
                    fontSize: "13px",
                    color: "#8b949e",
                    cursor: "not-allowed",
                  }}
                  readOnly
                />
                <Lock
                  size={13}
                  style={{
                    position: "absolute",
                    right: "12px",
                    top: "50%",
                    transform: "translateY(-50%)",
                    color: "#6e7681",
                  }}
                />
              </div>
            </div>
          </div>

          {/* Job Title */}
          <div style={{ marginBottom: "20px" }}>
            <label
              style={{
                display: "block",
                fontSize: "12px",
                fontWeight: 500,
                color: "#8b949e",
                marginBottom: "6px",
              }}
            >
              Job Title / Role
            </label>
            <input
              type="text"
              value={profile.jobTitle}
              placeholder="e.g. Senior QA Engineer / Full Stack Developer"
              style={{
                width: "100%",
                background: "rgba(0, 0, 0, 0.35)",
                border: "1px solid rgba(255, 255, 255, 0.12)",
                borderRadius: "8px",
                padding: "9px 12px",
                fontSize: "13px",
                color: "#e6edf3",
                outline: "none",
              }}
              onChange={(e) =>
                setProfile({ ...profile, jobTitle: e.target.value })
              }
            />
          </div>

          {/* Bio */}
          <div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                marginBottom: "6px",
              }}
            >
              <label
                style={{
                  fontSize: "12px",
                  fontWeight: 500,
                  color: "#8b949e",
                }}
              >
                Bio
              </label>
              <span style={{ fontSize: "11px", color: "#6e7681" }}>
                {profile?.bio?.length || 0} / 500
              </span>
            </div>
            <textarea
              rows="4"
              value={profile.bio}
              maxLength={500}
              placeholder="Write a few lines about your development stack, testing interests, or role..."
              style={{
                width: "100%",
                background: "rgba(0, 0, 0, 0.35)",
                border: "1px solid rgba(255, 255, 255, 0.12)",
                borderRadius: "8px",
                padding: "10px 12px",
                fontSize: "13px",
                color: "#e6edf3",
                outline: "none",
                lineHeight: 1.6,
                resize: "vertical",
              }}
              onChange={(e) => setProfile({ ...profile, bio: e.target.value })}
            />
          </div>

          {/* Actions */}
          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              gap: "12px",
              marginTop: "24px",
              paddingTop: "20px",
              borderTop: "1px solid rgba(255, 255, 255, 0.08)",
            }}
          >
            <button
              type="button"
              onClick={handleCancel}
              style={{
                padding: "8px 18px",
                borderRadius: "8px",
                background: "rgba(255, 255, 255, 0.04)",
                border: "1px solid rgba(255, 255, 255, 0.1)",
                fontSize: "13px",
                color: "#c9d1d9",
                cursor: "pointer",
                fontWeight: 500,
              }}
            >
              Cancel
            </button>
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              type="button"
              onClick={handleSave}
              disabled={isSaving}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                padding: "8px 20px",
                borderRadius: "8px",
                background: "linear-gradient(135deg, #7c3aed 0%, #6366f1 100%)",
                border: "none",
                fontSize: "13px",
                color: "#fff",
                fontWeight: 600,
                cursor: isSaving ? "not-allowed" : "pointer",
                boxShadow: "0 2px 10px rgba(124, 58, 237, 0.35)",
                opacity: isSaving ? 0.7 : 1,
              }}
            >
              <Save size={14} />
              {isSaving ? "Saving..." : "Save Changes"}
            </motion.button>
          </div>
        </div>
      </div>
    </div>
  );
}
