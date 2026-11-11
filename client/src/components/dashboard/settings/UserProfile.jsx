import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { User, Upload, Trash2, Lock, Save, CheckCircle2, AlertCircle } from "lucide-react";
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
  const [avatarFile, setAvatarFile] = useState(null);
  const [errors, setErrors] = useState({});
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
    if (!profile.name || !profile.name.trim()) {
      setErrors((prev) => ({ ...prev, name: "Name is required!" }));
      showToast({
        type: "error",
        title: "Validation Error",
        message: "Name is required!",
      });
      return;
    }

    const MAX_AVATAR_SIZE = 2 * 1024 * 1024; // 2MB
    let avatarSizeBytes = 0;
    if (avatarFile) {
      avatarSizeBytes = avatarFile.size;
    } else if (profile.avatarUrl?.startsWith("data:")) {
      const base64Part = profile.avatarUrl.split(",")[1] || "";
      avatarSizeBytes = Math.round((base64Part.length * 3) / 4);
    }

    if (avatarSizeBytes > MAX_AVATAR_SIZE) {
      showToast({
        type: "error",
        title: "Avatar Too Large",
        message: "Avatar image size must not exceed 2MB. Please select a smaller photo.",
      });
      return;
    }

    setIsSaving(true);
    setErrors({});
    try {
      await updateUserProfileApi({
        ...profile,
        name: profile.name.trim(),
      });
      setInitialProfile({
        ...profile,
        name: profile.name.trim(),
      });
      setAvatarFile(null);
      showToast({
        type: "success",
        title: "Profile Saved",
        message: "Your profile information has been updated successfully.",
      });
    } catch (error) {
      console.error("Error updating profile:", error);
      const msg = error.message || "Could not save profile changes. Please try again.";
      if (error.data?.error?.name) {
        setErrors((prev) => ({ ...prev, name: error.data.error.name[0] }));
      }
      showToast({
        type: "error",
        title: "Update Failed",
        message: msg,
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancel = () => {
    if (initialProfile) {
      setProfile(initialProfile);
      setAvatarFile(null);
      setErrors({});
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
    <div className="max-w-[920px] p-6 sm:p-8 font-sans text-[var(--color-text)]">
      {/* Header */}
      <div className="mb-7">
        <h1 className="text-lg font-bold text-[var(--color-text)] mb-1.5 flex items-center gap-2.5">
          <User size={20} className="text-[var(--color-primary)]" />
          User Profile
        </h1>
        <p className="text-xs text-[var(--color-text-secondary)]">
          Manage your public identity, personal details, and profile avatar.
        </p>
      </div>

      <div className="flex flex-col gap-6">
        {/* Profile Avatar Card */}
        <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-lg)] p-6">
          <div className="flex items-center gap-6 flex-wrap">
            <div
              className={`w-[84px] h-[84px] rounded-full bg-[var(--color-surface-secondary)] border-2 border-[var(--color-border)] flex items-center justify-center shrink-0 overflow-hidden ${
                profile.avatarUrl ? "cursor-pointer" : "default"
              }`}
              onClick={() => profile.avatarUrl && setIsAvatarExpanded(true)}
            >
              {profile.avatarUrl ? (
                <img
                  src={profile.avatarUrl}
                  alt="Avatar"
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="text-[var(--color-primary)] text-2xl font-bold tracking-wider font-mono">
                  {getInitials(profile.name)}
                </div>
              )}
            </div>

            {isAvatarExpanded && (
              <div
                className="fixed inset-0 bg-black/80 flex items-center justify-center z-[1000] p-4 cursor-pointer"
                onClick={() => setIsAvatarExpanded(false)}
              >
                <img
                  src={profile.avatarUrl}
                  alt="Expanded Avatar"
                  className="max-w-[80vw] max-h-[80vh] rounded-[var(--radius-lg)] border border-[var(--color-border)]"
                />
              </div>
            )}

            <input
              type="file"
              id="avatar-upload"
              className="hidden"
              accept="image/*"
              onChange={(e) => {
                if (e.target.files && e.target.files[0]) {
                  const file = e.target.files[0];
                  setAvatarFile(file);
                  const reader = new FileReader();
                  reader.onload = (event) => {
                    setProfile({ ...profile, avatarUrl: event.target.result });
                    showToast({
                      type: "info",
                      title: "Photo Selected",
                      message: "Remember to click 'Save Changes' to apply.",
                    });
                  };
                  reader.readAsDataURL(file);
                }
              }}
            />

            <div>
              <h3 className="text-sm font-semibold text-[var(--color-text)] mb-1">
                Profile Photo
              </h3>
              <p className="text-xs text-[var(--color-text-secondary)] mb-3">
                PNG, JPG, or GIF up to 2MB. Recommended 256x256px.
              </p>
              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  id="avatar-upload-btn"
                  onClick={() =>
                    document.getElementById("avatar-upload").click()
                  }
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-md)] bg-[var(--color-primary)] text-white text-xs font-semibold hover:bg-[var(--color-primary-hover)] transition-colors cursor-pointer"
                >
                  <Upload size={13} />
                  Upload New Photo
                </button>
                {profile.avatarUrl && (
                  <button
                    type="button"
                    onClick={() => {
                      setProfile({ ...profile, avatarUrl: "" });
                      setAvatarFile(null);
                    }}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-md)] bg-[var(--color-danger)]/10 border border-[var(--color-danger)]/25 text-[var(--color-danger)] text-xs font-semibold hover:bg-[var(--color-danger)]/20 transition-colors cursor-pointer"
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
        <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-lg)] p-6">
          <h3 className="text-sm font-semibold text-[var(--color-text)] mb-4">
            Personal Information
          </h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
            {/* Full Name */}
            <div>
              <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1.5">
                Full Name <span className="text-[var(--color-danger)]">*</span>
              </label>
              <input
                type="text"
                id="profile-name"
                value={profile.name}
                placeholder="e.g. Jane Doe"
                className={`w-full bg-[var(--color-bg)] border rounded-[var(--radius-md)] px-3 py-2 text-xs text-[var(--color-text)] placeholder-[var(--color-text-muted)] focus:outline-none transition-all font-sans ${
                  errors.name
                    ? "border-[var(--color-danger)] focus:border-[var(--color-danger)] focus:ring-1 focus:ring-[var(--color-danger)]"
                    : "border-[var(--color-border)] focus:border-[var(--color-primary)] focus:ring-1 focus:ring-[var(--color-primary)]"
                }`}
                onChange={(e) => {
                  setProfile({ ...profile, name: e.target.value });
                  if (errors.name) {
                    setErrors((prev) => ({ ...prev, name: "" }));
                  }
                }}
              />
              {errors.name && (
                <p className="mt-1 text-xs text-[var(--color-danger)] flex items-center gap-1">
                  <AlertCircle size={12} />
                  <span>{errors.name}</span>
                </p>
              )}
            </div>

            {/* Email Address */}
            <div>
              <div className="flex justify-between items-center mb-1.5">
                <label className="text-xs font-medium text-[var(--color-text-secondary)]">
                  Email Address
                </label>
                <span className="text-[11px] text-[var(--color-success)] flex items-center gap-1 font-medium">
                  <CheckCircle2 size={11} />
                  Verified
                </span>
              </div>
              <div className="relative">
                <input
                  type="text"
                  value={profile.email}
                  readOnly
                  className="w-full bg-[var(--color-surface-secondary)] border border-[var(--color-border)] rounded-[var(--radius-md)] pl-3 pr-8 py-2 text-xs text-[var(--color-text-muted)] cursor-not-allowed font-sans"
                />
                <Lock
                  size={13}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] pointer-events-none"
                />
              </div>
            </div>
          </div>

          {/* Job Title */}
          <div className="mb-4">
            <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1.5">
              Job Title / Role
            </label>
            <input
              type="text"
              value={profile.jobTitle}
              placeholder="e.g. Senior QA Engineer / Full Stack Developer"
              className="w-full bg-[var(--color-bg)] border border-[var(--color-border)] rounded-[var(--radius-md)] px-3 py-2 text-xs text-[var(--color-text)] placeholder-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-primary)] focus:ring-1 focus:ring-[var(--color-primary)] transition-all font-sans"
              onChange={(e) =>
                setProfile({ ...profile, jobTitle: e.target.value })
              }
            />
          </div>

          {/* Bio */}
          <div>
            <div className="flex justify-between items-center mb-1.5">
              <label className="text-xs font-medium text-[var(--color-text-secondary)]">
                Bio
              </label>
              <span className="text-[11px] text-[var(--color-text-muted)] font-mono">
                {profile?.bio?.length || 0} / 500
              </span>
            </div>
            <textarea
              rows="4"
              value={profile.bio}
              maxLength={500}
              placeholder="Write a few lines about your development stack, testing interests, or role..."
              className="w-full bg-[var(--color-bg)] border border-[var(--color-border)] rounded-[var(--radius-md)] p-3 text-xs text-[var(--color-text)] placeholder-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-primary)] focus:ring-1 focus:ring-[var(--color-primary)] transition-all font-sans leading-relaxed resize-y"
              onChange={(e) => setProfile({ ...profile, bio: e.target.value })}
            />
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-3 mt-6 pt-5 border-t border-[var(--color-border)]">
            <button
              type="button"
              onClick={handleCancel}
              className="px-4 py-2 rounded-[var(--radius-md)] bg-[var(--color-surface-secondary)] text-[var(--color-text)] border border-[var(--color-border)] text-xs font-semibold hover:bg-[var(--color-surface)] transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <motion.button
              whileTap={{ scale: 0.98 }}
              type="button"
              onClick={handleSave}
              disabled={isSaving}
              className="flex items-center gap-1.5 px-4 py-2 rounded-[var(--radius-md)] bg-[var(--color-primary)] text-white text-xs font-semibold hover:bg-[var(--color-primary-hover)] transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed shadow-xs"
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
