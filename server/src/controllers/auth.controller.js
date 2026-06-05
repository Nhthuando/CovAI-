import { authValid, loginValid } from "../validators/auth.validation.js";
import {
  register as registerService,
  login as loginService,
} from "../services/auth.service.js";

export const register = async (req, res) => {
  try {
    const result = authValid.safeParse(req.body);
    if (!result.success)
      return res
        .status(400)
        .json({ error: result.error.flatten().fieldErrors });

    const { name, email, password } = result.data;
    const response = await registerService(name, email, password);
    return res.status(201).json(response);
  } catch (error) {
    console.log(error);
    return res.status(500).json({ message: "Có lỗi server!" });
  }
};

export const login = async (req, res) => {
  try {
    const result = loginValid.safeParse(req.body);
    if (!result.success)
      return res
        .status(400)
        .json({ error: result.error.flatten().fieldErrors });

    const { email, password } = result.data;
    const response = await loginService(email, password);
    return res.status(200).json(response);
  } catch (error) {
    console.log(error);
    if (
      error.message === "Tài khoản đã tồn tại!" ||
      error.message === "Email hoặc mật khẩu không chính xác!"
    ) {
      return res.status(400).json({ message: error.message });
    }
    return res.status(500).json({ message: "Có lỗi server!" });
  }
};
