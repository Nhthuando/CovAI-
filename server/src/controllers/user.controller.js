import { meValid } from "../validators/user.validation.js";
import { updateUserService, getUserById } from "../services/user.service.js";

export const me = async (req, res) => {
  try {
    const { id } = req.user;
    const user = await getUserById(id);
    return res.status(200).json(user);
  } catch (error) {
    console.log(error);
    if (error.message === "User not found") {
      return res.status(404).json({ message: "User not found" });
    }
    return res.status(500).json({ message: "Server error!" });
  }
};

export const update = async (req, res) => {
  try {
    const result = meValid.safeParse(req.body);
    if (!result.success)
      return res
        .status(400)
        .json({ error: result.error.flatten().fieldErrors });

    const { id } = req.user;
    const { name, avatarUrl } = result.data;
    const user = await updateUserService(id, { name, avatarUrl });

    return res.status(200).json({
      message: "Profile updated successfully",
      user,
    });
  } catch (error) {
    console.log(error);
    if (error.message === "User not found") {
      return res.status(404).json({ message: "User not found" });
    }
    return res.status(500).json({ message: "Server error!" });
  }
};
