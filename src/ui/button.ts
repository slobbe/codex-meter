import Clutter from "gi://Clutter";
import St from "gi://St";

type ButtonOptions = {
    styleClass: string;
    onClick: (button: St.Button) => void;
};

type TextButtonOptions = ButtonOptions & {
    text: string;
};

type IconButtonOptions = ButtonOptions & {
    iconName: string;
    accessibleName: string;
};

export function createTextButton({ text, styleClass, onClick }: TextButtonOptions) {
    const label = new St.Label({
        text,
        y_align: Clutter.ActorAlign.CENTER,
    });
    const button = new St.Button({
        child: label,
        style_class: styleClass,
        can_focus: true,
        y_align: Clutter.ActorAlign.CENTER,
    });

    button.connect("clicked", () => onClick(button));

    return { button, label };
}

export function createIconButton({
    iconName,
    accessibleName,
    styleClass,
    onClick,
}: IconButtonOptions) {
    const icon = new St.Icon({
        icon_name: iconName,
        style_class: "popup-menu-icon",
    });
    const button = new St.Button({
        child: icon,
        style_class: styleClass,
        accessible_name: accessibleName,
        can_focus: true,
        x_align: Clutter.ActorAlign.END,
        y_align: Clutter.ActorAlign.CENTER,
    });

    button.connect("clicked", () => onClick(button));

    return { button, icon };
}
