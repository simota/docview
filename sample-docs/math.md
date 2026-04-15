# Mathematical Expressions

DocView renders math using [KaTeX](https://katex.org/). Both inline and display math are supported.

## Inline Math

The quadratic formula $x = \frac{-b \pm \sqrt{b^2 - 4ac}}{2a}$ gives the solutions of $ax^2 + bx + c = 0$.

Euler's identity $e^{i\pi} + 1 = 0$ connects five fundamental constants.

The derivative of $f(x) = x^n$ is $f'(x) = nx^{n-1}$.

## Display Math

### Quadratic Formula

$$x = \frac{-b \pm \sqrt{b^2 - 4ac}}{2a}$$

### Euler's Formula

$$e^{ix} = \cos(x) + i\sin(x)$$

### Integral

$$\int_{-\infty}^{\infty} e^{-x^2} dx = \sqrt{\pi}$$

### Summation

$$\sum_{n=1}^{\infty} \frac{1}{n^2} = \frac{\pi^2}{6}$$

### Matrix

$$A = \begin{pmatrix} a_{11} & a_{12} & a_{13} \\ a_{21} & a_{22} & a_{23} \\ a_{31} & a_{32} & a_{33} \end{pmatrix}$$

### System of Equations

$$\begin{cases} 3x + 2y - z = 1 \\ 2x - 2y + 4z = -2 \\ -x + \frac{1}{2}y - z = 0 \end{cases}$$

### Taylor Series

$$f(x) = \sum_{n=0}^{\infty} \frac{f^{(n)}(a)}{n!}(x-a)^n = f(a) + f'(a)(x-a) + \frac{f''(a)}{2!}(x-a)^2 + \cdots$$

### Fourier Transform

$$\hat{f}(\xi) = \int_{-\infty}^{\infty} f(x) \, e^{-2\pi i x \xi} \, dx$$

### Bayes' Theorem

$$P(A|B) = \frac{P(B|A) \cdot P(A)}{P(B)}$$

### Maxwell's Equations

$$\nabla \cdot \mathbf{E} = \frac{\rho}{\varepsilon_0}$$

$$\nabla \cdot \mathbf{B} = 0$$

$$\nabla \times \mathbf{E} = -\frac{\partial \mathbf{B}}{\partial t}$$

$$\nabla \times \mathbf{B} = \mu_0 \mathbf{J} + \mu_0 \varepsilon_0 \frac{\partial \mathbf{E}}{\partial t}$$

### Schrödinger Equation

$$i\hbar \frac{\partial}{\partial t} \Psi(\mathbf{r}, t) = \left[ -\frac{\hbar^2}{2m} \nabla^2 + V(\mathbf{r}, t) \right] \Psi(\mathbf{r}, t)$$

## Mixed Content

The **normal distribution** with mean $\mu$ and standard deviation $\sigma$ has the probability density function:

$$f(x) = \frac{1}{\sigma\sqrt{2\pi}} \exp\left(-\frac{(x - \mu)^2}{2\sigma^2}\right)$$

where:
- $\mu$ is the mean (expected value)
- $\sigma$ is the standard deviation
- $\sigma^2$ is the variance

For the standard normal distribution ($\mu = 0$, $\sigma = 1$), approximately:
- 68% of values fall within $\pm 1\sigma$
- 95% of values fall within $\pm 2\sigma$
- 99.7% of values fall within $\pm 3\sigma$
