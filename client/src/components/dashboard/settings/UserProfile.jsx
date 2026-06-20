import { useState, useEffect } from "react";
import {
  getUserProfileApi,
  updateUserProfileApi,
} from "../../../services/user.service";

export default function UserProfile() {
  const [isAvatarExpanded, setIsAvatarExpanded] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
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
        setProfile({
          name: data?.name || "",
          email: data?.email || "",
          jobTitle: data?.jobTitle || "",
          bio: data?.bio || "",
          avatarUrl: data?.avatarUrl || "",
        });
      } catch (error) {
        console.error("Error fetching user profile:", error);
        // Optionally show a toast message to the user
      }
    };
    fetchProfile();
  }, []);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await updateUserProfileApi(profile);
      alert("Profile updated successfully!");
    } catch (error) {
      console.error("Error updating profile:", error);
      alert("Failed to update profile.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div style={{ maxWidth: "896px", padding: "24px" }}>
      <h1
        style={{
          fontSize: "24px",
          fontWeight: 600,
          color: "#e6edf3",
          marginBottom: "8px",
        }}
      >
        User Profile
      </h1>
      <p style={{ color: "#8b949e", marginBottom: "32px" }}>
        Manage your public identity and personal details.
      </p>

      <div
        style={{
          background: "rgba(255,255,255,0.03)",
          border: "1px solid rgba(255,255,255,0.07)",
          borderRadius: "12px",
          padding: "24px",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "24px",
            marginBottom: "32px",
          }}
        >
          <div
            style={{
              width: "80px",
              height: "80px",
              borderRadius: "50%",
              background: "#1f242c",
              overflow: "hidden",
              border: "1px solid #30363d",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
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
              <div style={{ color: "#8b949e" }}>No Image</div>
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
                background: "rgba(0,0,0,0.8)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                zIndex: 1000,
              }}
              onClick={() => setIsAvatarExpanded(false)}
            >
              <img
                src={profile.avatarUrl}
                alt="Expanded Avatar"
                style={{
                  maxWidth: "80%",
                  maxHeight: "80%",
                  borderRadius: "8px",
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
                };
                reader.readAsDataURL(e.target.files[0]);
              }
            }}
          />
          <div>
            <h3
              style={{
                fontSize: "18px",
                fontWeight: 500,
                color: "#e6edf3",
                marginBottom: "8px",
              }}
            >
              Profile Avatar
            </h3>
            <div style={{ display: "flex", gap: "12px" }}>
              <button
                onClick={() => document.getElementById("avatar-upload").click()}
                style={{
                  padding: "6px 16px",
                  borderRadius: "6px",
                  background: "rgba(255,255,255,0.05)",
                  border: "1px solid rgba(255,255,255,0.1)",
                  fontSize: "12px",
                  color: "#c9d1d9",
                  cursor: "pointer",
                }}
              >
                Change
              </button>
              <button
                onClick={() => setProfile({ ...profile, avatarUrl: "" })}
                style={{
                  padding: "6px 16px",
                  borderRadius: "6px",
                  background: "transparent",
                  border: "1px solid rgba(255,255,255,0.1)",
                  fontSize: "12px",
                  color: "#f85149",
                  cursor: "pointer",
                }}
              >
                Remove
              </button>
            </div>
            <p style={{ fontSize: "12px", color: "#8b949e", marginTop: "8px" }}>
              JPG, GIF or PNG. Max size of 2MB.
            </p>
          </div>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: "24px",
            marginBottom: "24px",
          }}
        >
          <div>
            <label
              style={{
                display: "block",
                fontSize: "12px",
                color: "#8b949e",
                marginBottom: "8px",
              }}
            >
              Full Name
            </label>
            <input
              type="text"
              value={profile.name}
              style={{
                width: "100%",
                background: "#0d1117",
                border: "1px solid #30363d",
                borderRadius: "6px",
                padding: "8px",
                fontSize: "14px",
                color: "#e6edf3",
              }}
              onChange={(e) => setProfile({ ...profile, name: e.target.value })}
            />
          </div>
          <div>
            <label
              style={{
                display: "block",
                fontSize: "12px",
                color: "#8b949e",
                marginBottom: "8px",
              }}
            >
              Email Address
            </label>
            <input
              type="text"
              value={profile.email}
              style={{
                width: "100%",
                background: "#0d1117",
                border: "1px solid #30363d",
                borderRadius: "6px",
                padding: "8px",
                fontSize: "14px",
                color: "#e6edf3",
              }}
              readOnly
            />
          </div>
        </div>

        <div style={{ marginBottom: "24px" }}>
          <label
            style={{
              display: "block",
              fontSize: "12px",
              color: "#8b949e",
              marginBottom: "8px",
            }}
          >
            Job Title
          </label>
          <input
            type="text"
            value={profile.jobTitle}
            style={{
              width: "100%",
              background: "#0d1117",
              border: "1px solid #30363d",
              borderRadius: "6px",
              padding: "8px",
              fontSize: "14px",
              color: "#e6edf3",
            }}
            onChange={(e) =>
              setProfile({ ...profile, jobTitle: e.target.value })
            }
          />
        </div>

        <div style={{ marginBottom: "32px" }}>
          <label
            style={{
              display: "block",
              fontSize: "12px",
              color: "#8b949e",
              marginBottom: "8px",
            }}
          >
            Bio
          </label>
          <textarea
            rows="4"
            value={profile.bio}
            style={{
              width: "100%",
              background: "#0d1117",
              border: "1px solid #30363d",
              borderRadius: "6px",
              padding: "8px",
              fontSize: "14px",
              color: "#e6edf3",
            }}
            onChange={(e) => setProfile({ ...profile, bio: e.target.value })}
          />
          <div
            style={{
              textAlign: "right",
              fontSize: "12px",
              color: "#8b949e",
              marginTop: "4px",
            }}
          >
            {profile?.bio?.length} / 500
          </div>
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: "12px",
            paddingTop: "24px",
            borderTop: "1px solid rgba(255,255,255,0.07)",
          }}
        >
          <button
            style={{
              padding: "8px 16px",
              borderRadius: "6px",
              background: "transparent",
              border: "1px solid rgba(255,255,255,0.1)",
              fontSize: "14px",
              color: "#c9d1d9",
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={isSaving}
            style={{
              padding: "8px 16px",
              borderRadius: "6px",
              background: "#238636",
              border: "none",
              fontSize: "14px",
              color: "#fff",
              fontWeight: 500,
              cursor: "pointer",
              opacity: isSaving ? 0.7 : 1,
            }}
          >
            {isSaving ? "Saving..." : "Save Changes"}
          </button>
        </div>
      </div>
    </div>
  );
}
