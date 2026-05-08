import "@girs/gjs";
import "@girs/gjs/dom";
import "@girs/gnome-shell/ambient";
import "@girs/gnome-shell/extensions/global";

declare module "gi://Soup?version=3.0" {
    const Soup: any;
    export default Soup;
}
