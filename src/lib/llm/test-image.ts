import type { ImageContent } from "@earendil-works/pi-ai";

/**
 * A 120x60 PNG of the word "OK" in bold black on white, inlined so the model test has an image to
 * send without reading from disk or the network.
 *
 * The test asks the model to read the word back rather than merely accepting the request, because
 * the three failures it has to tell apart look the same from the outside: an endpoint that rejects
 * image blocks fails the request, an endpoint (or a model whose `input` omits "image") that
 * silently drops them answers about nothing, and a model that can see answers "OK". Only the word
 * coming back proves the pixels reached the model.
 */
const OK_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAHgAAAA8CAIAAAAiz+n/AAAFW0lEQVR4nOybLXSjWBSAyZ45J6wKq8KqMiqsCm4YFarKqrKqVJWqMmqoKnVxTV" +
  "SpKlVDHVVD1aRqqCpRSxxRQx1RQ9RQlaVrpjzyQ5pwM+J9J+pBfvhyue/d+5I3k8mEwJTPbwQGBCwaCCwaCCwaCCwaCCwaCCwaCCwaCCwaCCwa" +
  "CCwaCCwaCCwaCCwaCCwaiE2JjkPPMXVF5DmWoSmy8j8kzbAcLyqaYbtBXOBVQluiKi8hecNP5j8nCWyZqSDQoukXecPX84aAJYk8xzA65s1gnD" +
  "/4NHocpo9B/+764pioNXYVXdNkgSGJdZGEtirt3zxmBus7lz1b5SiiTCAjOgkdlWfe73enWs4xHt5eHG6/5RQrSIh1kL6/Ju5fDzODIJYJQNGx" +
  "Z8j8P1eDJ2JJhteHvNhxV72xk8jRJPlqM5YJKNFJYKnS8e1o1vFavdFobNVmHR7fn0qy6a8Q11FPTy1nv+X6LphlAkZ07JuqdpOzXHt3cP7l32" +
  "/ff0wmcRQEQRhPJj++f3v4fLa7lXuN8Z2mtF8Z1pGrS9JFP2fZArNMQIhOM2O7c48k5Xrr7GvgWZrIMdTLqY6kGF7SHf/h8qBZzT7laWB27OWz" +
  "dezqstTdsGUCQHS6mjJ72WiuNk9sRxfo2U+ieNVyeyeI6/GdYXpLBXXsdSSpm/2WN2GZKF907Fl2NpyIhmrowuLrpATdUBvZsaFjuRFRkOfpVz" +
  "z9JSwTpYuOg547yA41JbnghVKcLDWzQ49ur1hhEfuGLB3f/SKWibJFJ5HvBdmhpiCxRS+VYiUBNe35i/N04puKeHyXSVgbtUyULzoIs3mjzgpM" +
  "8YulGIGtZ4ciP5ob0kniW4r0IbuUrLXOnU1aJsoXHSHhR9H0MgU1SdOInTiO4tkh/fRcYh8iJXY6jfo9P1xPeflaShadkh2haHIp0SQqmkjmCh" +
  "sNBtPKonQZrrZXri5XoeTJMCd1+bBKFr5mIZ76XUVzNhfW5YomSTR+k3k3fp4kQXMPSZFF7om07DzaQQrMx2tFtfwNqS5ZNIXe+VEYLXMDx2GI" +
  "nE7lsnaO+s7ZF9+1TMv6mCt5Xl/Ir0jJohmOybaKxoEXFr/QdHsgQKpKhp3bnq61Tr76ji4+n0QLHauzk33/p0FXUe0NZJCyI5rlmOzQsOcU3s" +
  "t4LneyfU2C4bh5y5YqK8n8zxNITjXNPTSD3Khq2fspeUqeDClWREuOoW04xXpDsW87SFnZEKXlVsMkIxtTMoieZpDCtfxaKLvXQfGK/C57maNb" +
  "TSvQXI7djmZm47naUhV+6aqDFtpWp4VmkAtFA80gpXfvSFZWRaS6G98dC6Lei2ZfZ+Q+t92Q7ZiGosvcaxZ3FKda0zKIAphByu9Hk4zU1lvo7s" +
  "n4vvs3J+q2FyC649A1VZ7bPkVb2FsHHV2c01pd8CFkw/zYRD/DsdLuAWUQiB2WNKBMY6+eGx/dd/ff//Xn75UKRbMcz/Mcx5B/vN3+cNVHq7ta" +
  "68w2JIZYAVpsW+foFz64UDU7gMggMHuGJKuYzvlufdbx8Wg46Pf7g8HjtL3b1LJj6/zKLSFq1hrE8MrPIGC74BSv2d7nI3SDahHV5sEnd/52zB" +
  "KkE8a0DHKq6qVnEMjfdaTZ2vTCh08ne81agdO3WkeXzxuLylrbm2kGMc9yGeRK0axyM0hlQ39RTms+t+c4juuHURQ9jtKZr1rbSsu+FJYTRFEU" +
  "uMUN1dCWuP3bF7Nm9d2552qLliZJYCki2kxNE1TPWUOCmkEF/xccBvxrUiCwaCCwaCCwaCCwaCCwaCCwaCCwaCCwaCCwaCCwaCCwaCCwaCCwaC" +
  "CwaCD+AwAA//+vZcAqAAAABklEQVQDAPYJSiArRp7dAAAAAElFTkSuQmCC";

export const testImage: ImageContent = { type: "image", mimeType: "image/png", data: OK_PNG_BASE64 };
